// Shared browser helpers. Hashing and decryption happen here, in the verifier's browser,
// so the server never sees the decryption key or the plaintext during verification.

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(text) {
  return "0x" + hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function decryptRecord(rec, keyB64) {
  const key = await crypto.subtle.importKey("raw", fromB64url(keyB64), "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(rec.iv) }, key, fromB64url(rec.ct));
  return new TextDecoder().decode(pt);
}

async function api(url, opts = {}) {
  const token = sessionStorage.getItem("token");
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (h) => (h ? h.slice(0, 10) + "…" + h.slice(-6) : "");

function show(el, text, ok) {
  el.className = "msg " + (ok ? "ok" : "err");
  el.innerHTML = text;
}

async function footer() {
  try {
    const m = await api("/api/meta");
    const reg = m.explorer ? `<a href="${m.explorer}/address/${m.contracts.CredentialRegistry}" target="_blank"><code>${m.contracts.CredentialRegistry}</code></a>` : `<code>${m.contracts.CredentialRegistry}</code>`;
    $("footer").innerHTML = `Network ${m.network} (chain ID ${m.chainId}) · block #${m.block} · CredentialRegistry ${reg} · CS-491 CEP · Group: 22CS078, 22CS074, 22CS032`;
  } catch { $("footer").textContent = "Blockchain node not reachable."; }
}
