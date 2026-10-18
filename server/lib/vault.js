// Off-chain store. Holds ONLY ciphertext + non-personal metadata; the decryption key
// is never stored here (it lives in the QR code / the student's copy).
// Local demo: data/vault.json. Hosted: a Supabase (PostgreSQL) table, set SUPABASE_URL + SUPABASE_KEY.
//   create table vault (id text primary key, record jsonb not null);
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "vault.json");
const SB = process.env.SUPABASE_URL;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// ponytail: whole-file JSON store locally; Supabase when hosted
const fileVault = {
  async put(id, record) { const db = load(); db[id] = record; save(db); },
  async get(id) { return load()[id]; },
  async erase(id) { const db = load(); const had = id in db; delete db[id]; save(db); return had; },
  async list(issuer) { return Object.entries(load()).filter(([, r]) => !issuer || r.issuer === issuer).map(([id, r]) => ({ id, ...r })); },
  async reset() { save({}); },
};

async function rest(query, opts = {}) {
  const key = process.env.SUPABASE_KEY;
  const res = await fetch(`${SB}/rest/v1/vault${query}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...opts.headers },
  });
  if (!res.ok) throw new Error(`Vault error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const supabaseVault = {
  async put(id, record) {
    await rest("", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id, record }) });
  },
  async get(id) { const r = await rest(`?select=record&id=eq.${encodeURIComponent(id)}`); return r[0] && r[0].record; },
  async erase(id) { const r = await rest(`?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=representation" } }); return r.length > 0; },
  async list(issuer) {
    const q = issuer ? `&record->>issuer=eq.${encodeURIComponent(issuer)}` : "";
    return (await rest(`?select=id,record${q}`)).map((r) => ({ id: r.id, ...r.record }));
  },
  async reset() { await rest("?id=neq.__none__", { method: "DELETE" }); },
};

module.exports = SB ? supabaseVault : fileVault;
