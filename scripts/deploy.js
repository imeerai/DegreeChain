// Deploys the three contracts to the running network and accredits the demo universities.
// Usage: npx hardhat run scripts/deploy.js --network localhost
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const [hec, uniRep, auditor, muet, partner, unaccredited] = await ethers.getSigners();

  const council = await ethers.deployContract("GovernanceCouncil", [[hec, uniRep, auditor], 2]);
  await council.waitForDeployment();
  const inst = await ethers.deployContract("InstitutionRegistry", [council]);
  await inst.waitForDeployment();
  const creds = await ethers.deployContract("CredentialRegistry", [inst]);
  await creds.waitForDeployment();

  console.log("GovernanceCouncil   ", await council.getAddress());
  console.log("InstitutionRegistry ", await inst.getAddress());
  console.log("CredentialRegistry  ", await creds.getAddress());

  // 2-of-3 votes accredit each demo university
  for (const [signer, name] of [[muet, "MUET Jamshoro (Demo Node)"], [partner, "Partner University (Demo Node)"]]) {
    await (await inst.connect(hec).approveInstitution(signer, name)).wait();
    await (await inst.connect(uniRep).approveInstitution(signer, name)).wait();
    console.log("Accredited          ", name, signer.address);
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contracts: {},
    actors: {
      governors: [
        { label: "HEC Representative", address: hec.address, index: 0 },
        { label: "University Representative", address: uniRep.address, index: 1 },
        { label: "Independent Auditor", address: auditor.address, index: 2 },
      ],
      institutions: [
        { label: "MUET Jamshoro (Demo Node)", address: muet.address, index: 3 },
        { label: "Partner University (Demo Node)", address: partner.address, index: 4 },
        { label: "Unaccredited Institute", address: unaccredited.address, index: 5 },
      ],
    },
  };
  for (const [name, c] of [["GovernanceCouncil", council], ["InstitutionRegistry", inst], ["CredentialRegistry", creds]]) {
    out.contracts[name] = { address: await c.getAddress(), abi: (await artifacts.readArtifact(name)).abi };
  }
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`Saved deployments/${network.name}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
