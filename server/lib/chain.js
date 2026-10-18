// Connects to the blockchain node and exposes the three contracts.
// NETWORK=localhost (default, Hardhat node) or NETWORK=sepolia (public Ethereum testnet).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const NETWORK = process.env.NETWORK || "localhost";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
// Default = Hardhat's public test mnemonic, only for the local chain. On Sepolia the
// mnemonic comes from the hosting provider's secret environment variables.
const MNEMONIC = process.env.MNEMONIC || "test test test test test test test test test test test junk";

const deployFile = path.join(__dirname, "..", "..", "deployments", `${NETWORK}.json`);
let deployment = null;
if (fs.existsSync(deployFile)) deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
else if (process.env.DEPLOYED) {
  // Hosted: addresses come from the DEPLOYED env var printed by public/deploy.html,
  // ABIs and wallet list from public/deploy-artifacts.json (same MNEMONIC).
  const d = JSON.parse(process.env.DEPLOYED);
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "public", "deploy-artifacts.json"), "utf8"));
  deployment = {
    network: NETWORK, chainId: d.chainId || 11155111, explorer: d.explorer || "https://sepolia.etherscan.io", deployBlock: d.deployBlock || 0,
    actors: art.actors,
    contracts: Object.fromEntries(Object.keys(art.contracts).map((n) => [n, { address: d[n], abi: art.contracts[n].abi }])),
  };
}
else if (require.main !== module) console.error(`deployments/${NETWORK}.json not found. Deploy the contracts first.`);

const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1, staticNetwork: NETWORK !== "localhost" });

// signer #i of the mnemonic (same order as Hardhat's accounts)
function signer(index) {
  return ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
}

function need() {
  if (!deployment) throw new Error(`Contracts are not deployed on ${NETWORK} yet.`);
  return deployment;
}

const contract = (name, runner = provider) =>
  new ethers.Contract(need().contracts[name].address, need().contracts[name].abi, runner);

// Name of the custom error a transaction reverted with (e.g. "NotAccredited"), or null.
function errorName(e) {
  if (e.revert && e.revert.name) return e.revert.name;
  for (const name of Object.keys(deployment ? deployment.contracts : {})) {
    try { const p = contract(name).interface.parseError(e.data); if (p) return p.name; } catch {}
  }
  return null;
}

const STATUS = ["None", "Valid", "Revoked", "Superseded"];
const KINDS = ["Degree", "Transcript", "MicroCredential"];
const INST_STATUS = ["None", "Pending", "Active", "Suspended"];

module.exports = { errorName, ethers, provider, get deployment() { return need(); }, hasDeployment: () => !!deployment, signer, contract, STATUS, KINDS, INST_STATUS, NETWORK };
