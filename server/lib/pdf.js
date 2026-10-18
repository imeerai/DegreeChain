// Renders a credential (degree / transcript / micro-credential) as an A4 PDF.
// Anti-tamper features drawn on the page:
//  - a guilloche rosette in the middle of the page, generated from the on-chain fingerprint,
//    so every credential has a different pattern and it sits UNDER the text;
//  - the official seal in the centre, overlapping the text, with the fingerprint written
//    as micro-text around it. Cutting it out or pasting another seal breaks the match
//    with the QR code / fingerprint that the verifier checks on-chain.
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const nice = (iso) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const NAVY = "#1f3a5f";
const GOLD = "#9a7b2f";
const GREY = "#555555";
const INK = "#22307a"; // signature + seal ink
const MUET_LOGO = path.join(__dirname, "muet-logo.png");

// Full names printed on the certificate (labels in deployments/*.json are short).
function issuerOf(cred) {
  const n = cred.institution.name || "";
  if (/MUET/i.test(n)) return { full: "Mehran University of Engineering & Technology", place: "Jamshoro, Sindh, Pakistan", short: "MUET JAMSHORO", logo: MUET_LOGO };
  const base = n.replace(/\s*\(.*\)$/, "");
  return { full: base, place: "", short: base.toUpperCase(), logo: null };
}

// Small deterministic PRNG so the same credential always draws the same pattern.
function prng(seedHex) {
  let s = parseInt(seedHex.slice(2, 10), 16) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Hypotrochoid "spirograph" curve, the basic shape used on banknotes.
function rosette(doc, cx, cy, R, rnd, { layers = 3, color = NAVY, width = 0.35, opacity = 0.12 } = {}) {
  doc.save().lineWidth(width).strokeColor(color).strokeOpacity(opacity);
  for (let L = 0; L < layers; L++) {
    const n = 11 + Math.floor(rnd() * 9);       // 11..19
    const m = [2, 3, 4, 5][Math.floor(rnd() * 4)];
    const a = n, b = m, c = b * (0.55 + rnd() * 0.6);
    const scale = (R * (1 - L * 0.18)) / (a - b + c);
    const steps = 720 * m;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI * m;
      const x = cx + scale * ((a - b) * Math.cos(t) + c * Math.cos(((a - b) / b) * t));
      const y = cy + scale * ((a - b) * Math.sin(t) - c * Math.sin(((a - b) / b) * t));
      i ? doc.lineTo(x, y) : doc.moveTo(x, y);
    }
    doc.stroke();
  }
  doc.restore();
}

// Two interlaced sine waves along a straight edge (border band).
function waveLine(doc, x1, y1, x2, y2, amp, period) {
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (const ph of [0, Math.PI]) {
    for (let d = 0; d <= len; d += 1.5) {
      const o = amp * Math.sin((d / period) * 2 * Math.PI + ph);
      const x = x1 + ux * d - uy * o, y = y1 + uy * d + ux * o;
      d ? doc.lineTo(x, y) : doc.moveTo(x, y);
    }
    doc.stroke();
  }
}

// Text written around a circle, letters spread by their real width.
function ringText(doc, cx, cy, r, text, size, font = "Helvetica-Bold") {
  doc.font(font).fontSize(size);
  const widths = [...text].map((ch) => doc.widthOfString(ch) + size * 0.12);
  const total = widths.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + ((acc + widths[i] / 2) / total) * 2 * Math.PI;
    acc += widths[i];
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    doc.save().rotate((a * 180) / Math.PI + 90, { origin: [x, y] });
    doc.text(text[i], x - widths[i] / 2, y - size / 2, { lineBreak: false });
    doc.restore();
  }
}

// Official seal: rings, institution name, fingerprint micro-text, rosette core.
function seal(doc, cx, cy, r, issuer, hash) {
  doc.save().fillColor(INK).strokeColor(INK).fillOpacity(0.85).strokeOpacity(0.85);
  doc.lineWidth(2.2).circle(cx, cy, r).stroke();
  doc.lineWidth(0.6).circle(cx, cy, r - 4).stroke();
  doc.lineWidth(0.6).circle(cx, cy, r - 19).stroke();
  doc.lineWidth(0.4).circle(cx, cy, r - 26).stroke();
  ringText(doc, cx, cy, r - 12, `${issuer.short} * EXAMINATION OFFICE * BLOCKCHAIN SECURED * `, 6.6);
  ringText(doc, cx, cy, r - 22.5, hash.slice(2) + " ", 3.1, "Courier");
  doc.restore();
  rosette(doc, cx, cy, r - 30, prng(hash.slice(0, 2) + hash.slice(20, 28)), { layers: 2, color: INK, width: 0.3, opacity: 0.5 });
  doc.save().fillColor(INK).fillOpacity(0.9);
  doc.font("Helvetica-Bold").fontSize(7.5).text("RECORDED ON", cx - 30, cy - 12, { width: 60, align: "center" });
  doc.text("DEGREECHAIN", cx - 30, cy - 3, { width: 60, align: "center" });
  doc.font("Courier-Bold").fontSize(5.6).text(hash.slice(0, 8) + "..." + hash.slice(-4), cx - 30, cy + 7, { width: 60, align: "center" });
  doc.restore();
}

// Hand-written looking signature made of random Bezier loops (seeded, so it is stable).
function signature(doc, x, y, w, seedText) {
  const rnd = prng("0x" + Buffer.from(seedText).toString("hex").padEnd(8, "7"));
  doc.save().lineWidth(1.05).strokeColor(INK).lineCap("round").lineJoin("round");
  // pen path = forward drift + rotating loop (trochoid), slanted, with random letter heights
  const x0 = x + 18 + rnd() * 10, base = y - 8, len = w * (0.62 + rnd() * 0.15);
  const letters = 7 + Math.floor(rnd() * 4), slant = 0.35;
  const hts = Array.from({ length: letters }, (_, i) => (i === 0 ? 20 : 5 + rnd() * (rnd() < 0.3 ? 15 : 6)));
  const steps = letters * 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, k = Math.min(letters - 1, Math.floor(t * letters));
    const ang = t * letters * 2 * Math.PI;
    const r = hts[k] / 2;
    const py = base - r * (1 - Math.cos(ang));
    const px = x0 + t * len + 0.55 * r * Math.sin(ang) + slant * (base - py);
    i ? doc.lineTo(px, py) : doc.moveTo(px, py);
  }
  doc.stroke();
  // underline flourish crossing the signature
  doc.lineWidth(0.85).moveTo(x0 - 10, base + 3)
    .bezierCurveTo(x0 + len * 0.3, base + 9, x0 + len * 0.8, base - 6 - rnd() * 8, x0 + len + 18, base - 2 - rnd() * 6).stroke();
  doc.restore();
}

async function renderCredential(cred, docHash, verifyUrl, outPath) {
  const issuer = issuerOf(cred);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `${cred.type} - ${cred.holder.name}`, Subject: docHash } });
  const out = fs.createWriteStream(outPath);
  doc.pipe(out);
  const W = doc.page.width, H = doc.page.height; // 842 x 595
  const rnd = prng(docHash);

  // paper + borders
  doc.rect(0, 0, W, H).fill("#fbf8ef");
  doc.lineWidth(3).strokeColor(NAVY).rect(16, 16, W - 32, H - 32).stroke();
  doc.save().lineWidth(0.4).strokeColor(GOLD);
  waveLine(doc, 30, 26, W - 30, 26, 3, 9); waveLine(doc, 30, H - 26, W - 30, H - 26, 3, 9);
  waveLine(doc, 26, 30, 26, H - 30, 3, 9); waveLine(doc, W - 26, 30, W - 26, H - 30, 3, 9);
  doc.restore();
  doc.lineWidth(0.9).strokeColor(GOLD).rect(36, 36, W - 72, H - 72).stroke();
  for (const [x, y] of [[36, 36], [W - 36, 36], [36, H - 36], [W - 36, H - 36]]) rosette(doc, x, y, 13, prng(docHash), { layers: 1, color: GOLD, width: 0.4, opacity: 0.9 });

  // fingerprint-generated rosette in the middle, under all text
  rosette(doc, W / 2, 285, 175, rnd, { layers: 4, opacity: 0.10 });

  // header: serial no. (left), logo + name (centre), QR (right)
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("Serial No.", 58, 54);
  doc.font("Courier-Bold").fontSize(9).fillColor(NAVY).text(cred.credentialId.slice(2, 14).toUpperCase(), 58, 64);
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(`Issued: ${nice(cred.issuedOn)}`, 58, 78);

  if (issuer.logo && fs.existsSync(issuer.logo)) doc.image(issuer.logo, W / 2 - 32, 46, { width: 64 });
  else {
    doc.lineWidth(1.5).strokeColor(NAVY).circle(W / 2, 78, 30).stroke();
    doc.font("Times-Bold").fontSize(20).fillColor(NAVY).text(issuer.full.split(/\s+/).map((w) => w[0]).join("").slice(0, 3), W / 2 - 30, 68, { width: 60, align: "center" });
  }
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: "M" });
  doc.image(qr, W - 58 - 74, 46, { width: 74 });
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(NAVY).text("SCAN TO VERIFY", W - 58 - 74, 122, { width: 74, align: "center" });

  doc.font("Times-Bold").fontSize(23).fillColor(NAVY).text(issuer.full, 0, 116, { width: W, align: "center" });
  doc.font("Times-Roman").fontSize(10.5).fillColor(GREY)
    .text([cred.institution.department, issuer.place].filter(Boolean).join("  ·  "), 0, 143, { width: W, align: "center" });

  const title = { Degree: "DEGREE CERTIFICATE", Transcript: "ACADEMIC TRANSCRIPT", MicroCredential: "CERTIFICATE OF COMPLETION" }[cred.type];
  doc.font("Helvetica-Bold").fontSize(13).fillColor(GOLD).text(title, 0, 163, { width: W, align: "center", characterSpacing: 3 });
  const tw = doc.widthOfString(title, { characterSpacing: 3 });
  doc.lineWidth(0.6).strokeColor(GOLD).moveTo(W / 2 - tw / 2 - 40, 170).lineTo(W / 2 - tw / 2 - 10, 170).stroke()
    .moveTo(W / 2 + tw / 2 + 10, 170).lineTo(W / 2 + tw / 2 + 40, 170).stroke();

  const c = (t, y, font = "Times-Roman", size = 13.5, color = "#222") =>
    doc.font(font).fontSize(size).fillColor(color).text(t, 70, y, { width: W - 140, align: "center" });

  const h = cred.holder;
  if (cred.type === "Degree") {
    c("This is to certify that", 194);
    c(h.name, 213, "Times-BoldItalic", 27, NAVY);
    c(`son/daughter of ${h.fatherName}, Roll No. ${h.rollNo},`, 250);
    c("having fulfilled all the requirements prescribed by the University, has been awarded the degree of", 270);
    c(cred.programme, 294, "Times-Bold", 19, NAVY);
    c(`with a Cumulative Grade Point Average of ${cred.cgpa} out of 4.00, conferred on ${nice(cred.awardDate)}.`, 322);
  } else if (cred.type === "Transcript") {
    c(`${h.name}   |   Father: ${h.fatherName}   |   Roll No. ${h.rollNo}`, 192, "Times-Bold", 13, NAVY);
    c(cred.programme, 210, "Times-Roman", 11.5);
    const colW = [140, 120, 140], rowH = 16, x0 = (W - 400) / 2;
    let y = 230;
    doc.lineWidth(0.6).strokeColor(GREY);
    const row = (cells, bold) => {
      let x = x0;
      cells.forEach((t, k) => {
        if (bold) doc.save().rect(x, y, colW[k], rowH).fillOpacity(0.08).fill(NAVY).restore();
        doc.rect(x, y, colW[k], rowH).stroke();
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#222").text(String(t), x, y + 4.5, { width: colW[k], align: "center" });
        x += colW[k];
      });
      y += rowH;
    };
    row(["Semester", "Credit Hours", "Semester GPA"], true);
    cred.semesters.forEach((s) => row([s.term, s.credits, s.gpa]));
    c(`Cumulative GPA: ${cred.cgpa} / 4.00      Result declared: ${nice(cred.awardDate)}`, y + 8, "Times-Bold", 12, NAVY);
  } else {
    c("This is to certify that", 196);
    c(h.name, 216, "Times-BoldItalic", 27, NAVY);
    c(`Roll No. ${h.rollNo}, has successfully completed the short course`, 254);
    c(cred.programme, 278, "Times-Bold", 19, NAVY);
    c(`(${cred.hours} contact hours, assessed: ${cred.grade}) on ${nice(cred.awardDate)}.`, 306);
  }

  // signatures (left and right) with the seal between them, over the text block
  const sigY = 452;
  [[110, "Controller of Examinations"], [W - 110 - 190, "Registrar"]].forEach(([x, label]) => {
    signature(doc, x, sigY - 3, 190, label + cred.institution.name);
    doc.lineWidth(0.7).strokeColor("#333").moveTo(x, sigY).lineTo(x + 190, sigY).stroke();
    doc.font("Times-Bold").fontSize(10.5).fillColor(NAVY).text(label, x, sigY + 5, { width: 190, align: "center" });
    doc.font("Times-Roman").fontSize(8.5).fillColor(GREY).text(issuer.full, x, sigY + 18, { width: 190, align: "center" });
  });
  seal(doc, W / 2, 400, 62, issuer, docHash);

  // footer
  doc.font("Courier").fontSize(6.3).fillColor(GREY)
    .text(`Credential ID: ${cred.credentialId}`, 52, 503, { width: W - 104 })
    .text(`SHA-256 fingerprint (on-chain): ${docHash}`, 52, 511, { width: W - 104 })
    .text(`Issuer wallet: ${cred.institution.address}. Verify by scanning the QR code or uploading the credential .json file at the DegreeChain verify page.`, 52, 519, { width: W - 104 });
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#a33")
    .text("SPECIMEN - CS-491 CEP DEMONSTRATION, NOT A REAL ACADEMIC DOCUMENT", 52, 531, { width: W - 104 });

  doc.end();
  await new Promise((res) => out.on("finish", res));
  return outPath;
}

module.exports = { renderCredential };
