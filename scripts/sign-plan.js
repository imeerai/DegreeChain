// Signs the calls in data/plan.json (written by OFFLINE=1 seed) as raw transactions,
// so they can be broadcast from any machine that can reach the network (no key needed there).
// Usage: NETWORK=sepolia MAX_FEE_GWEI=20 node scripts/sign-plan.js  -> data/raw-txs.json
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const NETWORK = process.env.NETWORK || "sepolia";
const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${NETWORK}.json`), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "plan.json"), "utf8"));
const reg = new ethers.Interface(dep.contracts.CredentialRegistry.abi);
const maxFee = ethers.parseUnits(process.env.MAX_FEE_GWEI || "20", "gwei");
const tip = ethers.parseUnits(process.env.TIP_GWEI || "1.5", "gwei");
const nonce = {}; // fresh wallets start at 0; START_NONCE_<index> overrides

(async () => {
  const raw = [];
  for (const p of plan) {
    const w = ethers.HDNodeWallet.fromPhrase(process.env.MNEMONIC, undefined, `m/44'/60'/0'/0/${p.from}`);
    nonce[p.from] ??= Number(process.env[`START_NONCE_${p.from}`] || 0);
    raw.push({ fn: p.fn, from: w.address, raw: await w.signTransaction({
      type: 2, chainId: dep.chainId, nonce: nonce[p.from]++, to: dep.contracts.CredentialRegistry.address,
      data: reg.encodeFunctionData(p.fn, p.args), gasLimit: p.gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip,
    }) });
  }
  fs.writeFileSync(path.join(__dirname, "..", "data", "raw-txs.json"), JSON.stringify(raw, null, 2));
  console.log(`${raw.length} signed transactions in data/raw-txs.json`);
})();
