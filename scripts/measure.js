// Measures gas per operation, local throughput/latency and block capacity.
// Usage: npx hardhat run scripts/measure.js   (runs on the in-process Hardhat network)
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const rnd = () => ethers.hexlify(ethers.randomBytes(32));
const gas = async (txPromise) => Number((await (await txPromise).wait()).gasUsed);

async function main() {
  const [hec, uniRep, auditor, muet] = await ethers.getSigners();
  const r = { gas: {}, throughput: {}, capacity: {}, storage: {} };

  const council = await ethers.deployContract("GovernanceCouncil", [[hec, uniRep, auditor], 2]);
  r.gas["deploy GovernanceCouncil"] = Number((await council.deploymentTransaction().wait()).gasUsed);
  const inst = await ethers.deployContract("InstitutionRegistry", [council]);
  r.gas["deploy InstitutionRegistry"] = Number((await inst.deploymentTransaction().wait()).gasUsed);
  const creds = await ethers.deployContract("CredentialRegistry", [inst]);
  r.gas["deploy CredentialRegistry"] = Number((await creds.deploymentTransaction().wait()).gasUsed);

  r.gas["approveInstitution (1st vote)"] = await gas(inst.connect(hec).approveInstitution(muet, "MUET Jamshoro"));
  r.gas["approveInstitution (quorum vote)"] = await gas(inst.connect(uniRep).approveInstitution(muet, "MUET Jamshoro"));

  const c = creds.connect(muet);
  await (await c.issue(rnd(), rnd(), 0)).wait(); // first issue also initialises totalIssued
  const id = rnd();
  r.gas["issue (typical)"] = await gas(c.issue(id, rnd(), 0));
  const id2 = rnd();
  await (await c.issue(id2, rnd(), 1)).wait();
  r.gas["correct (supersede + new)"] = await gas(c.correct(id2, rnd(), rnd()));
  r.gas["revoke"] = await gas(c.revoke(id, 2));
  r.gas["verify (view, free)"] = Number(await creds.verify.estimateGas(id, rnd()));

  // 1) sequential latency: each transaction waits for its receipt (automine = 1 tx per block)
  const N = 300;
  const lat = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    await (await c.issue(rnd(), rnd(), 0)).wait();
    lat.push(performance.now() - s);
  }
  const secs = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  r.throughput = {
    transactions: N, seconds: +secs.toFixed(2), tps: +(N / secs).toFixed(1),
    latencyMsAvg: +(lat.reduce((a, b) => a + b, 0) / N).toFixed(1),
    latencyMsP95: +lat[Math.floor(N * 0.95)].toFixed(1),
  };

  // 2) block capacity: queue many issues, mine one block, count what fits in the gas limit
  await network.provider.send("evm_setAutomine", [false]);
  const nonce = await muet.getNonce();
  const sent = 500;
  for (let i = 0; i < sent; i++) await c.issue(rnd(), rnd(), 0, { nonce: nonce + i, gasLimit: 120000 });
  await network.provider.send("evm_mine");
  const block = await ethers.provider.getBlock("latest");
  await network.provider.send("evm_setAutomine", [true]);
  const perBlock = block.transactions.length;
  r.capacity = {
    blockGasLimit: Number(block.gasLimit), gasUsedInBlock: Number(block.gasUsed), issuesPerBlock: perBlock,
    tpsAt2sBlocks: +(perBlock / 2).toFixed(1), tpsAt5sBlocks: +(perBlock / 5).toFixed(1),
    issuesPerDayAt2s: Math.floor(perBlock * 43200),
  };

  // 3) storage growth per credential
  const rc = await (await c.issue(rnd(), rnd(), 0)).wait();
  const vaultFile = path.join(__dirname, "..", "data", "vault.json");
  let ct = 700;
  if (fs.existsSync(vaultFile)) {
    const recs = Object.values(JSON.parse(fs.readFileSync(vaultFile, "utf8")));
    if (recs.length) ct = Math.round(recs.reduce((a, x) => a + JSON.stringify(x).length, 0) / recs.length);
  }
  const stateBytes = 3 * 32; // docHash | issuer+issuedAt+status+kind (packed) | replacedBy
  const logBytes = rc.logs.reduce((a, l) => a + l.topics.length * 32 + (l.data.length - 2) / 2, 0);
  const perYear = 500000; // assumption: credentials issued per year across the network
  r.storage = {
    onChainStateBytes: stateBytes, eventLogBytes: logBytes, offChainCiphertextBytes: ct,
    assumedCredentialsPerYear: perYear,
    onChainMBPerYear: +(((stateBytes + logBytes) * perYear) / 1e6).toFixed(1),
    offChainMBPerYear: +((ct * perYear) / 1e6).toFixed(1),
  };

  fs.mkdirSync(path.join(__dirname, "..", "reports"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "reports", "measurements.json"), JSON.stringify(r, null, 2));

  console.log("\nGas used per operation");
  console.table(r.gas);
  console.log("Sequential load (1 tx per block, local Hardhat node)");
  console.table(r.throughput);
  console.log("Block capacity (30M gas block)");
  console.table(r.capacity);
  console.log("Storage growth per credential / per year");
  console.table(r.storage);
}

main().catch((e) => { console.error(e); process.exit(1); });
