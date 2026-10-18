require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the solc 0.8.24 compiler shipped in node_modules (npm package "solc"),
// so compiling works offline / behind firewalls that block binaries.soliditylang.org.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: "0.8.24",
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { blockGasLimit: 30_000_000 }, // same as a typical Besu/QBFT consortium block
    localhost: { url: "http://127.0.0.1:8545" },
    // Public Ethereum test network. Alternative to the MetaMask page (public/deploy.html):
    // npx hardhat run scripts/deploy.js --network sepolia  (MNEMONIC must hold Sepolia ETH)
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: { mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk" },
    },
  },
  gasReporter: { enabled: false },
};
