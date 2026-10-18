// Issues the demo credentials and writes them to samples-local/ (local chain) or samples/ (Sepolia).
require("dotenv").config();
// Deterministic: on a fresh `npx hardhat node` + `npm run deploy`, the same IDs, keys
// and fingerprints are produced, so the sample files always verify the same way.
// Usage: node scripts/seed.js   (node and server do NOT need to be running together)
// OFFLINE=1 node scripts/seed.js  -> no chain access: writes samples/, data/vault-rows.json and
//   data/plan.json (the on-chain calls still to be made, signed later by scripts/sign-plan.js).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { contract, signer, deployment, errorName } = require("../server/lib/chain");
const { issueCredential, prepareCredential, renderPdf } = require("../server/lib/issuer");
const OFFLINE = !!process.env.OFFLINE;
const plan = [], vaultRows = {};
const vault = require("../server/lib/vault");

const NET = process.env.NETWORK || "localhost";
// samples/ = live Sepolia deployment, samples-local/ = local Hardhat chain
const SAMPLES = path.join(__dirname, "..", NET === "localhost" ? "samples-local" : "samples");
const det = (name) => (label, n) =>
  crypto.createHmac("sha256", "degreechain-demo-seed").update(`${name}/${label}`).digest().subarray(0, n);

const MUET = 3, PARTNER = 4, UNACCREDITED = 5;
const DEPT = "Department of Computer Systems Engineering";

async function main() {
  if (!OFFLINE) await vault.reset();
  fs.rmSync(SAMPLES, { recursive: true, force: true });
  fs.mkdirSync(SAMPLES, { recursive: true });
  const expected = [];

  async function make(file, form, inst, expect, extra = {}) {
    const args = [{ issuedOn: "2026-10-17", department: DEPT, ...form }, { instIndex: inst, rand: det(file), ...extra }];
    let r;
    if (OFFLINE) {
      r = prepareCredential(...args);
      r.pdfPath = await renderPdf(r);
      vaultRows[r.id] = r.vaultRecord;
      plan.push(r.replaces ? { from: inst, fn: "correct", args: [r.replaces, r.id, r.docHash], gas: 180000 }
        : { from: inst, fn: "issue", args: [r.id, r.docHash, r.kind], gas: 150000 });
      r.blockNumber = "-"; r.gasUsed = "-";
    } else r = await issueCredential(...args);
    fs.copyFileSync(r.pdfPath, path.join(SAMPLES, `${file}.pdf`));
    fs.writeFileSync(path.join(SAMPLES, `${file}.json`), JSON.stringify(r.credential, null, 2));
    expected.push({ file, expect, id: r.id, verifyUrl: r.verifyUrl, gasUsed: r.gasUsed });
    console.log(`${file.padEnd(28)} block ${r.blockNumber}  gas ${r.gasUsed}`);
    return r;
  }

  const degree = await make("01-degree-valid", {
    type: "Degree", holder: { name: "Sara Ahmed Memon", fatherName: "Ahmed Ali Memon", rollNo: "21CS901" },
    programme: "Bachelor of Engineering in Computer Systems Engineering", cgpa: "3.12", awardDate: "2025-12-20",
  }, MUET, "VERIFIED");

  await make("02-transcript-valid", {
    type: "Transcript", holder: { name: "Bilal Hussain Shah", fatherName: "Hussain Shah", rollNo: "21CS902" },
    programme: "Bachelor of Engineering in Computer Systems Engineering", cgpa: "3.48", awardDate: "2025-12-20",
    semesters: [
      { term: "Fall 2021", credits: "18", gpa: "3.31" }, { term: "Spring 2022", credits: "19", gpa: "3.40" },
      { term: "Fall 2022", credits: "18", gpa: "3.52" }, { term: "Spring 2023", credits: "18", gpa: "3.61" },
    ],
  }, MUET, "VERIFIED");

  await make("03-microcredential-valid", {
    type: "MicroCredential", holder: { name: "Hina Qureshi", fatherName: "", rollNo: "PU-SC-0457" },
    programme: "Blockchain Fundamentals (Short Course)", hours: "20", grade: "Pass with distinction", awardDate: "2026-08-30",
    department: "Continuing Education Centre",
  }, PARTNER, "VERIFIED");

  const revoked = await make("04-degree-revoked", {
    type: "Degree", holder: { name: "Kamran Ali Jatoi", fatherName: "Ali Nawaz Jatoi", rollNo: "21CS904" },
    programme: "Bachelor of Engineering in Computer Systems Engineering", cgpa: "2.85", awardDate: "2025-12-20",
  }, MUET, "REVOKED");
  if (OFFLINE) plan.push({ from: MUET, fn: "revoke", args: [revoked.id, 2], gas: 60000 });
  else await (await contract("CredentialRegistry", signer(MUET)).revoke(revoked.id, 2)).wait();
  console.log("04-degree-revoked            revoked (reason 2 = fraud)");

  const wrong = await make("05a-transcript-superseded", {
    type: "Transcript", holder: { name: "Zainab Somro", fatherName: "Ghulam Rasool Soomro", rollNo: "21CS905" },
    programme: "Bachelor of Engineering in Computer Systems Engineering", cgpa: "3.70", awardDate: "2025-12-20",
    semesters: [{ term: "Fall 2021", credits: "18", gpa: "3.65" }, { term: "Spring 2022", credits: "19", gpa: "3.75" }],
  }, MUET, "SUPERSEDED");
  await make("05b-transcript-corrected", {
    type: "Transcript", holder: { name: "Zainab Soomro", fatherName: "Ghulam Rasool Soomro", rollNo: "21CS905" },
    programme: "Bachelor of Engineering in Computer Systems Engineering", cgpa: "3.70", awardDate: "2025-12-20",
    semesters: [{ term: "Fall 2021", credits: "18", gpa: "3.65" }, { term: "Spring 2022", credits: "19", gpa: "3.75" }],
  }, MUET, "VERIFIED", { replaces: wrong.id });

  // Forged copy: someone edits the CGPA in a genuine credential file.
  const forged = { ...degree.credential, cgpa: "3.92" };
  fs.writeFileSync(path.join(SAMPLES, "06-degree-tampered.json"), JSON.stringify(forged, null, 2));
  expected.push({ file: "06-degree-tampered", expect: "NOT AUTHENTIC (fingerprint mismatch)", id: forged.credentialId });
  console.log("06-degree-tampered           CGPA 3.12 -> 3.92 in the JSON copy");

  // A degree mill tries to issue: the contract rejects it.
  if (!OFFLINE) try {
    await issueCredential({ type: "Degree", holder: { name: "Fake Person", rollNo: "X-1" }, programme: "PhD", awardDate: "2026-01-01" },
      { instIndex: UNACCREDITED });
  } catch (e) {
    console.log("07-unaccredited-institute    rejected:", errorName(e) || e.shortMessage);
  }

  fs.writeFileSync(path.join(SAMPLES, "expected-results.json"), JSON.stringify(expected, null, 2));
  if (OFFLINE) {
    fs.writeFileSync(path.join(__dirname, "..", "data", "plan.json"), JSON.stringify(plan, null, 2));
    fs.writeFileSync(path.join(__dirname, "..", "data", "vault-rows.json"), JSON.stringify(vaultRows, null, 2));
    console.log(`\nOFFLINE: ${plan.length} calls in data/plan.json, ${Object.keys(vaultRows).length} vault rows`);
  } else console.log(`\nSamples written to ${path.basename(SAMPLES)}/ (registry ${deployment.contracts.CredentialRegistry.address})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
