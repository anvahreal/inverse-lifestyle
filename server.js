require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const EARLY_BIRD_LIMIT = 50;

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "public", "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });

// Helpers
function readData() {
  const fp = path.join(__dirname, "data.json");
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = fs.readFileSync(fp);
    return raw.length ? JSON.parse(raw) : [];
  } catch { return []; }
}
function writeData(data) {
  fs.writeFileSync(path.join(__dirname, "data.json"), JSON.stringify(data, null, 2));
}
function earlyBirdCount(data) {
  return data.filter(e => (e.ticketType || "").toLowerCase().includes("yahooze")).length;
}

// ─── GET /tickets-left ────────────────────────────────────────────────────────
app.get("/tickets-left", (req, res) => {
  const data = readData();
  const used = earlyBirdCount(data);
  res.json({ left: Math.max(0, EARLY_BIRD_LIMIT - used), total: EARLY_BIRD_LIMIT, used });
});

// ─── POST /submit ─────────────────────────────────────────────────────────────
app.post("/submit", upload.single("paymentProof"), (req, res) => {
  const data = readData();
  const { accountName, email, phone, ticketType } = req.body;

  if (!accountName || !email || !phone) {
    return res.status(400).send("Missing required fields.");
  }

  // Duplicate check
  const exists = data.find(e => e.email === email || e.phone === phone);
  if (exists) {
    return res.status(400).send("You've already registered with this email or phone number.");
  }

  // Early bird cap check
  if ((ticketType || "").toLowerCase().includes("yahooze")) {
    if (earlyBirdCount(data) >= EARLY_BIRD_LIMIT) {
      return res.status(400).send("Sorry! All 50 Yahooze (Early Bird) spots are sold out. Please choose another ticket.");
    }
  }

  data.push({
    accountName,
    email,
    phone,
    ticketType: ticketType || "General",
    proof: req.file ? `/uploads/${req.file.filename}` : null,
    approved: false,
    qr: null,
    registeredAt: new Date().toISOString(),
  });

  writeData(data);
  res.redirect("/thankyou.html");
});

// ─── Admin Auth ───────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

const adminAuth = (req, res, next) => {
  const b64 = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, pass] = Buffer.from(b64, "base64").toString().split(":");
  if (login === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
  res.status(401).send("Authentication required.");
};


// ─── GET /admin ───────────────────────────────────────────────────────────────
app.get("/admin", adminAuth, (req, res) => {
  const data = readData();
  const approved = data.filter(e => e.approved).length;
  const pending = data.length - approved;
  const ebUsed = earlyBirdCount(data);

  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px;">
      ${[
        { label: "Total", val: data.length, color: "#ff0090" },
        { label: "Approved", val: approved, color: "#00cc99" },
        { label: "Pending", val: pending, color: "#ffe600" },
        { label: "Yahooze Left", val: EARLY_BIRD_LIMIT - ebUsed, color: "#aa44ff" },
      ].map(s => `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:2rem;font-weight:900;color:${s.color};">${s.val}</div>
          <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:2px;margin-top:4px;">${s.label}</div>
        </div>
      `).join("")}
    </div>
  `;

  const rows = data.length === 0
    ? `<p style="text-align:center;padding:60px;color:rgba(255,255,255,0.3);">No registrations yet.</p>`
    : data.map((e, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:22px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:1.05rem;font-weight:800;">${e.accountName}</div>
            <div style="font-size:0.83rem;color:rgba(255,255,255,0.45);margin-top:3px;">${e.email} &nbsp;|&nbsp; ${e.phone}</div>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="background:rgba(255,0,144,0.12);border:1px solid rgba(255,0,144,0.3);color:#ff0090;font-size:0.68rem;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:100px;text-transform:uppercase;">${e.ticketType || "General"}</span>
              ${e.registeredAt ? `<span style="font-size:0.72rem;color:rgba(255,255,255,0.25);">${new Date(e.registeredAt).toLocaleString()}</span>` : ""}
            </div>
          </div>
          <div>
            ${e.approved
              ? `<span style="color:#00cc99;font-weight:800;font-size:0.9rem;">✓ Approved</span>`
              : `<form action="/approve/${i}" method="POST" style="margin:0;">
                  <button type="submit" style="background:linear-gradient(135deg,#ff0090,#cc0073);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.83rem;">Approve &amp; Send QR</button>
                </form>`
            }
          </div>
        </div>
        ${e.proof ? `<div style="margin-top:14px;"><div style="font-size:0.7rem;color:rgba(255,255,255,0.25);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Payment Proof</div><a href="${e.proof}" target="_blank"><img src="${e.proof}" alt="proof" style="max-width:130px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);" /></a></div>` : ""}
        ${e.qr ? `<div style="margin-top:14px;"><div style="font-size:0.7rem;color:rgba(255,255,255,0.25);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">QR Code</div><img src="${e.qr}" alt="QR" style="max-width:110px;border-radius:8px;" /></div>` : ""}
      </div>
    `).join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&display=swap" rel="stylesheet"/>
  <title>Admin — Indigenous Lifestyle</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Outfit',sans-serif;background:#0d001a;color:#fff;min-height:100vh;padding:28px 20px;}
    .wrap{max-width:900px;margin:0 auto;}
    .top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;}
    h1{font-size:1.8rem;font-weight:900;margin-bottom:4px;}
    .sub{color:rgba(255,255,255,0.35);font-size:0.85rem;margin-bottom:24px;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div style="font-size:1.2rem;font-weight:900;color:#ff0090;">Indigenous Lifestyle · Admin</div>
      <a href="/" style="color:rgba(255,255,255,0.35);font-size:0.82rem;text-decoration:none;">← Back to site</a>
    </div>
    <h1>Registrations</h1>
    <p class="sub">Approve payments to send QR codes via email.</p>
    ${statsHtml}
    ${rows}
  </div>
</body>
</html>`);
});

// ─── POST /approve/:id ────────────────────────────────────────────────────────
app.post("/approve/:id", adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const data = readData();
  if (!data[id]) return res.status(404).send("Not found.");

  data[id].approved = true;
  const e = data[id];
  const qrText = `${e.accountName} | ${e.email} | ${e.phone} | ${e.ticketType}`;

  const qrDir = path.join(__dirname, "public", "qrs");
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
  const qrPath = path.join(qrDir, `qr_${id}.png`);

  try {
    await QRCode.toFile(qrPath, qrText);
    data[id].qr = `/qrs/qr_${id}.png`;
    writeData(data);

    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) {
      console.warn("⚠️  RESEND_KEY not set — email skipped.");
      return res.redirect("/admin");
    }

    await axios.post("https://api.resend.com/emails", {
      from: "noreply@indigenouslifestyle.com",
      to: e.email,
      subject: `🎟 Your QR Code — Indigenous Lifestyle Y2K Party`,
      text: `Hey ${e.accountName}!\n\nYour ${e.ticketType} ticket has been approved! 🎉\n\nYour QR entry pass is attached. Show it at the door on Nov 7, 2026.\n\nSee you there!\n\n— Indigenous Lifestyle Team`,
      attachments: [{ filename: `qr_${id}.png`, path: qrPath }],
    }, { headers: { Authorization: `Bearer ${RESEND_KEY}` } });

    console.log(`✅ QR sent to ${e.email}`);
  } catch (err) {
    console.error("QR/email error:", err.message);
  }

  res.redirect("/admin");
});

// Start
app.listen(PORT, () => console.log(`✅ Server running → http://localhost:${PORT}`));
