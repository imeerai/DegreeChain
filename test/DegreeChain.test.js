const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DEGREE = 0, TRANSCRIPT = 1;
const VALID = 1n, REVOKED = 2n, SUPERSEDED = 3n;
const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s)); // stand-in for the off-chain document hash
const id = (s) => ethers.id(s);

async function deploy() {
  const [hec, uniRep, auditor, muet, otherUni, stranger] = await ethers.getSigners();
  const council = await ethers.deployContract("GovernanceCouncil", [[hec, uniRep, auditor], 2]);
  const inst = await ethers.deployContract("InstitutionRegistry", [council]);
  const creds = await ethers.deployContract("CredentialRegistry", [inst]);
  return { council, inst, creds, hec, uniRep, auditor, muet, otherUni, stranger };
}

async function deployWithMuet() {
  const f = await deploy();
  await f.inst.connect(f.hec).approveInstitution(f.muet, "MUET Jamshoro");
  await f.inst.connect(f.uniRep).approveInstitution(f.muet, "MUET Jamshoro");
  return f;
}

describe("GovernanceCouncil", () => {
  it("rejects a quorum larger than the council", async () => {
    const [a, b] = await ethers.getSigners();
    const F = await ethers.getContractFactory("GovernanceCouncil");
    await expect(F.deploy([a, b], 3)).to.be.revertedWithCustomError(F, "BadQuorum");
  });

  it("rejects duplicate governors", async () => {
    const [a] = await ethers.getSigners();
    const F = await ethers.getContractFactory("GovernanceCouncil");
    await expect(F.deploy([a, a], 1)).to.be.revertedWithCustomError(F, "DuplicateGovernor");
  });
});

describe("InstitutionRegistry (quorum accreditation)", () => {
  it("needs 2 of 3 governor votes before an institution becomes active", async () => {
    const { inst, hec, uniRep, muet } = await loadFixture(deploy);
    await expect(inst.connect(hec).approveInstitution(muet, "MUET Jamshoro"))
      .to.emit(inst, "ApprovalVoted").withArgs(muet.address, hec.address, 1);
    expect(await inst.isActive(muet)).to.equal(false);
    await expect(inst.connect(uniRep).approveInstitution(muet, "MUET Jamshoro"))
      .to.emit(inst, "InstitutionAccredited").withArgs(muet.address, "MUET Jamshoro");
    expect(await inst.isActive(muet)).to.equal(true);
  });

  it("blocks non-governors and double voting", async () => {
    const { inst, hec, muet, stranger } = await loadFixture(deploy);
    await expect(inst.connect(stranger).approveInstitution(muet, "Fake"))
      .to.be.revertedWithCustomError(inst, "NotGovernor");
    await inst.connect(hec).approveInstitution(muet, "MUET Jamshoro");
    await expect(inst.connect(hec).approveInstitution(muet, "MUET Jamshoro"))
      .to.be.revertedWithCustomError(inst, "AlreadyVoted");
  });

  it("rejects zero address and re-approving an active institution", async () => {
    const { inst, hec, muet } = await loadFixture(deployWithMuet);
    await expect(inst.connect(hec).approveInstitution(ethers.ZeroAddress, "X"))
      .to.be.revertedWithCustomError(inst, "ZeroAddress");
    await expect(inst.connect(hec).approveInstitution(muet, "MUET Jamshoro"))
      .to.be.revertedWithCustomError(inst, "AlreadyActive");
  });

  it("suspends with quorum and allows re-accreditation later", async () => {
    const { inst, hec, auditor, uniRep, muet } = await loadFixture(deployWithMuet);
    await inst.connect(hec).suspendInstitution(muet, 1);
    await expect(inst.connect(auditor).suspendInstitution(muet, 1))
      .to.emit(inst, "InstitutionSuspended").withArgs(muet.address, 1);
    expect(await inst.isActive(muet)).to.equal(false);
    // old approval votes do not carry over: a fresh quorum is needed
    await inst.connect(hec).approveInstitution(muet, "");
    expect(await inst.isActive(muet)).to.equal(false);
    await inst.connect(uniRep).approveInstitution(muet, "");
    expect(await inst.isActive(muet)).to.equal(true);
  });
});

describe("CredentialRegistry", () => {
  it("lets an accredited university issue and anyone verify", async () => {
    const { creds, muet, stranger } = await loadFixture(deployWithMuet);
    await expect(creds.connect(muet).issue(id("c1"), h("doc1"), DEGREE))
      .to.emit(creds, "CredentialIssued").withArgs(id("c1"), muet.address, DEGREE, h("doc1"));
    const r = await creds.connect(stranger).verify(id("c1"), h("doc1"));
    expect(r.status).to.equal(VALID);
    expect(r.hashMatches).to.equal(true);
    expect(r.issuerActive).to.equal(true);
    expect(r.issuer).to.equal(muet.address);
  });

  it("detects a tampered document (hash mismatch)", async () => {
    const { creds, muet } = await loadFixture(deployWithMuet);
    await creds.connect(muet).issue(id("c1"), h("CGPA 3.10"), DEGREE);
    const r = await creds.verify(id("c1"), h("CGPA 3.90"));
    expect(r.hashMatches).to.equal(false);
  });

  it("refuses issuance from a non-accredited address (degree mill)", async () => {
    const { creds, otherUni } = await loadFixture(deployWithMuet);
    await expect(creds.connect(otherUni).issue(id("x"), h("x"), DEGREE))
      .to.be.revertedWithCustomError(creds, "NotAccredited");
  });

  it("refuses duplicate ids and empty values", async () => {
    const { creds, muet } = await loadFixture(deployWithMuet);
    await creds.connect(muet).issue(id("c1"), h("a"), DEGREE);
    await expect(creds.connect(muet).issue(id("c1"), h("b"), DEGREE))
      .to.be.revertedWithCustomError(creds, "AlreadyExists");
    await expect(creds.connect(muet).issue(ethers.ZeroHash, h("b"), DEGREE))
      .to.be.revertedWithCustomError(creds, "EmptyValue");
  });

  it("only the issuer can revoke, and only once", async () => {
    const { creds, muet, hec } = await loadFixture(deployWithMuet);
    await creds.connect(muet).issue(id("c1"), h("a"), DEGREE);
    await expect(creds.connect(hec).revoke(id("c1"), 2)).to.be.revertedWithCustomError(creds, "NotIssuer");
    await expect(creds.connect(muet).revoke(id("c1"), 2))
      .to.emit(creds, "CredentialRevoked").withArgs(id("c1"), muet.address, 2);
    expect((await creds.verify(id("c1"), h("a"))).status).to.equal(REVOKED);
    await expect(creds.connect(muet).revoke(id("c1"), 2)).to.be.revertedWithCustomError(creds, "NotValid");
  });

  it("corrects an error by superseding, keeping the history", async () => {
    const { creds, muet } = await loadFixture(deployWithMuet);
    await creds.connect(muet).issue(id("old"), h("Name: Ali Kahn"), TRANSCRIPT);
    await expect(creds.connect(muet).correct(id("old"), id("new"), h("Name: Ali Khan")))
      .to.emit(creds, "CredentialCorrected").withArgs(id("old"), id("new"), muet.address);
    const oldR = await creds.verify(id("old"), h("Name: Ali Kahn"));
    expect(oldR.status).to.equal(SUPERSEDED);
    expect(oldR.replacedBy).to.equal(id("new"));
    const newR = await creds.verify(id("new"), h("Name: Ali Khan"));
    expect(newR.status).to.equal(VALID);
    expect(await creds.totalIssued()).to.equal(2n);
  });

  it("keeps old credentials but flags them when the issuer is suspended", async () => {
    const { creds, inst, muet, hec, auditor } = await loadFixture(deployWithMuet);
    await creds.connect(muet).issue(id("c1"), h("a"), DEGREE);
    await inst.connect(hec).suspendInstitution(muet, 1);
    await inst.connect(auditor).suspendInstitution(muet, 1);
    const r = await creds.verify(id("c1"), h("a"));
    expect(r.status).to.equal(VALID);
    expect(r.issuerActive).to.equal(false);
    await expect(creds.connect(muet).issue(id("c2"), h("b"), DEGREE))
      .to.be.revertedWithCustomError(creds, "NotAccredited");
    // a suspended university can still revoke its own bad records
    await expect(creds.connect(muet).revoke(id("c1"), 1)).to.emit(creds, "CredentialRevoked");
  });

  it("returns status None for an unknown credential id", async () => {
    const { creds } = await loadFixture(deployWithMuet);
    const r = await creds.verify(id("missing"), h("a"));
    expect(r.status).to.equal(0n);
    expect(r.hashMatches).to.equal(false);
  });
});
