// Issuance pipeline used by both the web portal and the seed script:
// build JSON -> hash -> encrypt -> write hash on-chain -> store ciphertext -> render PDF.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const chain = require("./chain");
const { hashCredential, encrypt, decrypt, b64url } = require("./crypto");
const vault = require("./vault");
const { renderCredential } = require("./pdf");

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";
// Serverless hosts (Vercel) only allow writing to /tmp.
const OUT_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "issued") : path.join(__dirname, "..", "..", "data", "issued");

// Key that only the issuing university's server can derive (from its own signing key).
// It wraps the record key, so the office can reopen its own records (e.g. to correct them)
// while the vault still holds nothing readable.
const issuerWrapKey = (instIndex) =>
  crypto.createHash("sha256").update(chain.signer(instIndex).privateKey + "/degreechain-vault").digest();
const wrapKey = (key, instIndex, iv = crypto.randomBytes(12)) => encrypt(b64url(key), issuerWrapKey(instIndex), iv);

// Opens a record for the university that issued it.
function openRecord(record, instIndex) {
  if (!record.issuerKey) return null;
  const key = Buffer.from(decrypt(record.issuerKey, issuerWrapKey(instIndex)), "base64url");
  return JSON.parse(decrypt(record, key));
}

function institutionOf(index) {
  const inst = chain.deployment.actors.institutions.find((i) => i.index === index);
  if (!inst) throw new Error("Unknown institution account");
  return inst;
}

// Everything that does not touch the chain: record, fingerprint, ciphertext, QR link.
// `rand(label, n)` gives randomness. The seed script passes a deterministic one so the
// sample files stay valid every time the demo chain is rebuilt.
function prepareCredential(form, { instIndex, replaces = null, rand = (_, n) => crypto.randomBytes(n) } = {}) {
  const inst = institutionOf(instIndex);
  const kind = chain.KINDS.indexOf(form.type);
  if (kind < 0) throw new Error("type must be Degree, Transcript or MicroCredential");
  if (!form.holder || !form.holder.name || !form.holder.rollNo) throw new Error("holder name and roll number are required");

  const id = "0x" + rand("id", 32).toString("hex");
  const key = rand("key", 32);
  const cred = {
    schema: "degreechain/v1",
    credentialId: id,
    type: form.type,
    institution: { name: inst.label, department: form.department || "", address: inst.address },
    holder: { name: form.holder.name, fatherName: form.holder.fatherName || "", rollNo: form.holder.rollNo },
    programme: form.programme,
    cgpa: form.cgpa ?? null,
    awardDate: form.awardDate,
    issuedOn: form.issuedOn || new Date().toISOString().slice(0, 10),
    salt: b64url(rand("salt", 16)), // stops anyone guessing the fields and brute-forcing the hash
  };
  if (form.type === "Transcript") cred.semesters = form.semesters || [];
  if (form.type === "MicroCredential") Object.assign(cred, { hours: form.hours, grade: form.grade });
  if (replaces) cred.replaces = replaces;

  return {
    id, kind, replaces, credential: cred, docHash: hashCredential(cred), inst,
    vaultRecord: {
      ...encrypt(JSON.stringify(cred), key, rand("iv", 12)),
      issuerKey: wrapKey(key, instIndex, rand("wrap-iv", 12)),
      issuer: inst.address,
      kind: form.type,
      holderRoll: cred.holder.rollNo, // shown only in the issuer's own portal list
      createdAt: cred.issuedOn,
    },
    verifyUrl: `${PUBLIC_URL}/verify.html#c=${id}&k=${b64url(key)}`,
  };
}

async function renderPdf(p) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pdfPath = path.join(OUT_DIR, `${p.id.slice(2, 14)}.pdf`);
  await renderCredential(p.credential, p.docHash, p.verifyUrl, pdfPath);
  return pdfPath;
}

async function issueCredential(form, opts = {}) {
  const p = prepareCredential(form, opts);
  const registry = chain.contract("CredentialRegistry", chain.signer(opts.instIndex));
  const tx = p.replaces ? await registry.correct(p.replaces, p.id, p.docHash) : await registry.issue(p.id, p.docHash, p.kind);
  const receipt = await tx.wait();
  await vault.put(p.id, p.vaultRecord);
  const pdfPath = await renderPdf(p);
  return {
    ...p, pdfPath,
    txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
  };
}

module.exports = { issueCredential, prepareCredential, renderPdf, openRecord, wrapKey, OUT_DIR };
