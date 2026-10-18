// DegreeChain web server: university portal, council portal and public verification API.
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const chain = require("./lib/chain");
const { errorName, provider, contract, signer, STATUS, INST_STATUS } = chain;
const { issueCredential } = require("./lib/issuer");
const vault = require("./lib/vault");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- login (demo passwords come from .env) ----------
const PASSWORDS = { university: process.env.UNIVERSITY_PASSWORD || "uni123", council: process.env.COUNCIL_PASSWORD || "council123" };
// Stateless signed tokens (HMAC), so logins survive on serverless hosts with many instances.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sign = (body) => crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
const makeToken = (s) => { const b = Buffer.from(JSON.stringify(s)).toString("base64url"); return `${b}.${sign(b)}`; };
function readToken(t) {
  const [b, mac] = String(t || "").split(".");
  if (!b || !mac || !same(mac, sign(b))) return null;
  try { return JSON.parse(Buffer.from(b, "base64url").toString()); } catch { return null; }
}

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post("/api/login", (req, res) => {
  const { role, index, password } = req.body || {};
  const list = role === "council" ? chain.deployment.actors.governors : chain.deployment.actors.institutions;
  const actor = list && list.find((a) => a.index === Number(index));
  if (!actor || !PASSWORDS[role] || !same(String(password || ""), PASSWORDS[role])) {
    return res.status(401).json({ error: "Wrong account or password" });
  }
  const token = makeToken({ role, index: actor.index, address: actor.address, label: actor.label, expires: Date.now() + 3600e3 });
  res.json({ token, label: actor.label, address: actor.address });
});

function auth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "") || req.query.t;
    const s = readToken(token);
    if (!s || s.expires < Date.now() || s.role !== role) return res.status(401).json({ error: "Please log in again" });
    req.user = s;
    next();
  };
}

// Turn contract custom errors into readable messages.
const MESSAGES = {
  NotAccredited: "This institution is not accredited (or is suspended) and cannot issue credentials.",
  NotIssuer: "Only the university that issued this credential can change it.",
  NotValid: "This credential is already revoked or superseded.",
  AlreadyExists: "A credential with this ID already exists.",
  NotGovernor: "Only council governors can vote.",
  AlreadyVoted: "You have already voted in this round.",
  AlreadyActive: "This institution is already accredited.",
  NotActive: "Only an active institution can be suspended.",
};
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    const name = errorName(e);
    res.status(400).json({ error: MESSAGES[name] || e.shortMessage || e.message, code: name });
  }
};

// ---------- public ----------
app.get("/api/meta", wrap(async (req, res) => {
  const deployment = chain.deployment;
  res.json({
    network: chain.NETWORK,
    explorer: deployment.explorer || null,
    chainId: deployment.chainId,
    block: await provider.getBlockNumber(),
    contracts: Object.fromEntries(Object.entries(deployment.contracts).map(([k, v]) => [k, v.address])),
    actors: deployment.actors,
  });
}));

app.get("/api/institutions", wrap(async (req, res) => {
  const reg = contract("InstitutionRegistry");
  const council = contract("GovernanceCouncil");
  const rows = await Promise.all(chain.deployment.actors.institutions.map(async (a) => {
    const i = await reg.institutions(a.address);
    return { ...a, name: i.name || a.label, status: INST_STATUS[Number(i.status)], votes: Number(i.votes) };
  }));
  res.json({ quorum: Number(await council.quorum()), institutions: rows });
}));

app.get("/api/vault/:id", wrap(async (req, res) => {
  const r = await vault.get(req.params.id);
  if (!r) return res.status(404).json({ error: "Off-chain record not found (it may have been erased on request)." });
  res.json({ iv: r.iv, ct: r.ct });
}));

app.get("/api/verify/:id", wrap(async (req, res) => {
  const { id } = req.params;
  const hash = String(req.query.hash || "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(id) || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return res.status(400).json({ error: "Credential ID and hash must be 32-byte hex values." });
  }
  const r = await contract("CredentialRegistry").verify(id, hash);
  const inst = chain.deployment.actors.institutions.find((a) => a.address === r.issuer);
  res.json({
    status: STATUS[Number(r.status)],
    hashMatches: r.hashMatches,
    issuerActive: r.issuerActive,
    issuer: r.issuer,
    issuerName: inst ? inst.label : null,
    issuedAt: Number(r.issuedAt),
    replacedBy: r.replacedBy === "0x" + "0".repeat(64) ? null : r.replacedBy,
    checkedAtBlock: await provider.getBlockNumber(),
    registry: chain.deployment.contracts.CredentialRegistry.address,
  });
}));

// Recent on-chain events = public audit trail.
app.get("/api/audit", wrap(async (req, res) => {
  const out = [];
  for (const name of ["InstitutionRegistry", "CredentialRegistry"]) {
    const c = contract(name);
    // ponytail: one getLogs call from the deploy block; chunk it if a public RPC rejects the range
    for (const log of await c.queryFilter("*", chain.deployment.deployBlock || 0)) {
      out.push({ contract: name, event: log.fragment ? log.fragment.name : "?", block: log.blockNumber, tx: log.transactionHash,
        args: log.args ? log.args.map((a) => (typeof a === "bigint" ? a.toString() : a)) : [] });
    }
  }
  out.sort((a, b) => b.block - a.block);
  res.json(out.slice(0, 60));
}));

// ---------- council ----------
app.post("/api/council/vote", auth("council"), wrap(async (req, res) => {
  const { action, institution, name, reason } = req.body;
  const reg = contract("InstitutionRegistry", signer(req.user.index));
  const tx = action === "suspend"
    ? await reg.suspendInstitution(institution, Number(reason) || 1)
    : await reg.approveInstitution(institution, name || "");
  const rc = await tx.wait();
  res.json({ ok: true, txHash: rc.hash, block: rc.blockNumber, gasUsed: rc.gasUsed.toString() });
}));

// ---------- university ----------
app.get("/api/credentials", auth("university"), wrap(async (req, res) => {
  const reg = contract("CredentialRegistry");
  const rows = await Promise.all((await vault.list(req.user.address)).map(async (r) => {
    const v = await reg.verify(r.id, "0x" + "0".repeat(64));
    return { id: r.id, kind: r.kind, holderRoll: r.holderRoll, createdAt: r.createdAt, status: STATUS[Number(v.status)] };
  }));
  res.json(rows.reverse());
}));

app.post("/api/credentials", auth("university"), wrap(async (req, res) => {
  const out = await issueCredential(req.body, { instIndex: req.user.index });
  res.json(summary(out));
}));

app.post("/api/credentials/:id/revoke", auth("university"), wrap(async (req, res) => {
  const reg = contract("CredentialRegistry", signer(req.user.index));
  const rc = await (await reg.revoke(req.params.id, Number(req.body.reason) || 1)).wait();
  res.json({ ok: true, txHash: rc.hash, gasUsed: rc.gasUsed.toString() });
}));

app.post("/api/credentials/:id/correct", auth("university"), wrap(async (req, res) => {
  const out = await issueCredential(req.body, { instIndex: req.user.index, replaces: req.params.id });
  res.json(summary(out));
}));

// Right to erasure: delete the ciphertext. Only the bare hash remains on-chain.
app.delete("/api/credentials/:id/offchain", auth("university"), wrap(async (req, res) => {
  const r = await vault.get(req.params.id);
  if (!r || r.issuer !== req.user.address) return res.status(404).json({ error: "Record not found" });
  await vault.erase(req.params.id);
  res.json({ ok: true });
}));

// PDF and .json go back in the response itself (serverless hosts have no lasting disk).
function summary(out) {
  return { id: out.id, docHash: out.docHash, verifyUrl: out.verifyUrl, txHash: out.txHash, block: out.blockNumber,
    gasUsed: out.gasUsed, credential: out.credential, pdfBase64: fs.readFileSync(out.pdfPath).toString("base64"),
    explorer: chain.deployment.explorer || null };
}

module.exports = app; // used by api/index.js on Vercel
if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`DegreeChain running at http://localhost:${PORT}`));
}
