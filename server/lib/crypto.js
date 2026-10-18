// Hashing and encryption used by the issuer side.
// The browser does the same steps with WebCrypto (public/js/common.js), so both sides agree.
const crypto = require("crypto");

// Canonical JSON: keys sorted at every level, no spaces. Same input => same hash.
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const sha256Hex = (text) => "0x" + crypto.createHash("sha256").update(text, "utf8").digest("hex");
const hashCredential = (cred) => sha256Hex(canonical(cred));
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// AES-256-GCM. Output layout matches WebCrypto: ciphertext followed by the 16-byte tag.
function encrypt(plaintext, key, iv = crypto.randomBytes(12)) {
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final(), c.getAuthTag()]);
  return { iv: b64url(iv), ct: b64url(ct) };
}

function decrypt({ iv, ct }, key) {
  const raw = Buffer.from(ct, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8");
}

module.exports = { canonical, sha256Hex, hashCredential, encrypt, decrypt, b64url };

if (require.main === module) {
  // self-check: node server/lib/crypto.js
  const assert = require("assert");
  assert.equal(canonical({ b: 1, a: { d: [2, 1], c: "x" } }), '{"a":{"c":"x","d":[2,1]},"b":1}');
  assert.equal(hashCredential({ a: 1, b: 2 }), hashCredential({ b: 2, a: 1 }));
  const key = crypto.randomBytes(32);
  assert.equal(decrypt(encrypt("salam", key), key), "salam");
  assert.throws(() => decrypt(encrypt("salam", key), crypto.randomBytes(32)));
  console.log("crypto self-check passed");
}
