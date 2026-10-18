// Writes public/deploy-artifacts.json for the MetaMask deploy page (public/deploy.html):
// contract ABI + bytecode and the operator wallet addresses derived from MNEMONIC.
// Usage: npx hardhat compile && node scripts/export-artifacts.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const phrase = process.env.MNEMONIC || "test test test test test test test test test test test junk";
const addr = (i) => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).address;
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`), "utf8"));

const out = {
  quorum: 2,
  contracts: Object.fromEntries(["GovernanceCouncil", "InstitutionRegistry", "CredentialRegistry"].map((n) => [n, { abi: art(n).abi, bytecode: art(n).bytecode }])),
  actors: {
    governors: [
      { label: "HEC Representative", address: addr(0), index: 0 },
      { label: "University Representative", address: addr(1), index: 1 },
      { label: "Independent Auditor", address: addr(2), index: 2 },
    ],
    institutions: [
      { label: "MUET Jamshoro", address: addr(3), index: 3 },
      { label: "Partner University", address: addr(4), index: 4 },
      { label: "Unaccredited Institute", address: addr(5), index: 5 },
    ],
  },
};
fs.writeFileSync(path.join(__dirname, "..", "public", "deploy-artifacts.json"), JSON.stringify(out));
console.log("public/deploy-artifacts.json written for", out.actors.governors.map((g) => g.address).join(", "));
