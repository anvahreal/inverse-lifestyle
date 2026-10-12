require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "public", "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

// Helper: read data.json safely
function readData() {
  const filePath = path.join(__dirname, "data.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath);
    return raw.length ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Helper: write data.json
function writeData(data) {
  const filePath = path.join(__dirname, "data.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// POST /submit
app.post("/submit", upload.single("paymentProof"), (req, res) => {
  const data = readData();

  const { accountName, email, phone, ticketType } = req.body;

  if (!accountName || !email || !phone) {
    return res.status(400).send("Missing required fields.");
  }

  const exists = data.find(e => e.email === email || e.phone === phone);
  if (exists) {
    return res.status(400).send("You've already registered with this phone or email.");
  }

  const formData = {
    accountName,
    email,
    phone,
    ticketType: ticketType || "General",
    proof: req.file ? `/uploads/${req.file.filename}` : null,
    approved: false,
    qr: null,
    registeredAt: new Date().toISOString(),
  };

  data.push(formData);
  writeData(data);
  res.redirect("/thankyou.html");
});

// ─── Admin Auth ───────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "secret123";

const adminAuth = (req, res, next) => {
  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64").toString().split(":");
  if (login === ADMIN_USER && password === ADMIN_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
  res.status(401).send("Authentication required.");
};

// ─── GET /admin ───────────────────────────────────────────────────────────────
app.get("/admin", adminAuth, (req, res) => {
  const data = readData();

  const ticketCounts = {};
  data.forEach(e => {
    const t = e.ticketType || "General";
    ticketCounts[t] = (ticketCounts[t] || 0) + 1;
  });

  const approvedCount = data.filter(e => e.approved).length;
  const pendingCount = data.length - approvedCount;

  const statsHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:32px;">
      ${[
        { label: "Total", val: data.length, color: "#66ff7f" },
        { label: "Approved", val: approvedCount, color: "#00cc99" },
        { label: "Pending", val: pendingCount, color: "#f59e0b" },
      ].map(s => `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:2rem;font-weight:900;color:${s.color};">${s.val}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:2px;margin-top:4px;">${s.label}</div>
        </div>
      `).join("")}
    </div>
  `;

  const rowsHtml = data.length === 0
    ? `<div style="text-align:center;padding:60px;color:rgba(255,255,255,0.3);">No registrations yet.</div>`
    : data.map((entry, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:1.05rem;font-weight:800;">${entry.accountName}</div>
            <div style="font-size:0.85rem;color:rgba(255,255,255,0.5);margin-top:2px;">${entry.email} &nbsp;|&nbsp; ${entry.phone}</div>
            <div style="margin-top:8px;">
              <span style="background:rgba(102,255,127,0.1);border:1px solid rgba(102,255,127,0.3);color:#66ff7f;font-size:0.7rem;font-weight:700;letter-spacing:1px;padding:4px 12px;border-radius:100px;text-transform:uppercase;">${entry.ticketType || "General"}</span>
              ${entry.registeredAt ? `<span style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-left:10px;">${new Date(entry.registeredAt).toLocaleString()}</span>` : ''}
            </div>
          </div>
          <div>
            ${entry.approved
              ? `<span style="color:#66ff7f;font-weight:800;font-size:0.9rem;">✓ Approved</span>`
              : `<form action="/approve/${i}" method="POST" style="margin:0;">
                  <button type="submit" style="background:linear-gradient(135deg,#66ff7f,#00cc99);color:#000;border:none;padding:10px 22px;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.85rem;">Approve & Send QR</button>
                </form>`
            }
          </div>
        </div>
        ${entry.proof ? `
          <div style="margin-top:16px;">
            <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Payment Proof</div>
            <a href="${entry.proof}" target="_blank"><img src="${entry.proof}" alt="proof" style="max-width:140px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);" /></a>
          </div>
        ` : ''}
        ${entry.qr ? `
          <div style="margin-top:16px;">
            <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">QR Code</div>
            <img src="${entry.qr}" alt="QR Code" style="max-width:120px;border-radius:8px;" />
          </div>
        ` : ''}
      </div>
    `).join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <title>Admin — Inv3rse Lifestyle</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Outfit',sans-serif;background:#050a0a;color:#fff;min-height:100vh;padding:32px 20px;}
        .container{max-width:900px;margin:0 auto;}
        h1{font-size:2rem;font-weight:900;margin-bottom:6px;}
        .sub{color:rgba(255,255,255,0.4);font-size:0.9rem;margin-bottom:32px;}
        .top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px;}
        a.logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:#66ff7f;font-weight:800;}
        a.logo img{height:36px;border-radius:4px;}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="top">
          <a class="logo" href="/"><img src="/assets/images/INV3RSE_L.jpg" alt=""/> Admin Panel</a>
          <a href="/" style="color:rgba(255,255,255,0.4);font-size:0.85rem;text-decoration:none;">← Back to site</a>
        </div>
        <h1>Registrations</h1>
        <p class="sub">Manage all attendees. Approve payments to send QR codes.</p>
        ${statsHtml}
        ${rowsHtml}
      </div>
    </body>
    </html>
  `);
});

// ─── POST /approve/:id ────────────────────────────────────────────────────────
app.post("/approve/:id", adminAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const data = readData();

  if (!data[id]) return res.status(404).send("User not found.");

  data[id].approved = true;
  const entry = data[id];
  const userQRData = `${entry.accountName} | ${entry.email} | ${entry.phone} | ${entry.ticketType || "General"}`;

  const qrDir = path.join(__dirname, "public", "qrs");
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

  const qrPath = path.join(qrDir, `qr_${id}.png`);

  try {
    await QRCode.toFile(qrPath, userQRData);
    data[id].qr = `/qrs/qr_${id}.png`;
    writeData(data);

    // Send email
    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) {
      console.warn("⚠️  RESEND_KEY not set in .env — email skipped.");
      writeData(data);
      return res.redirect("/admin");
    }

    await axios.post("https://api.resend.com/emails", {
      from: "noreply@inv3rse.com",
      to: entry.email,
      subject: "🎟 Your QR Code — Inv3rse Lifestyle",
      text: `Hey ${entry.accountName}!\n\nYour ${entry.ticketType || "General"} ticket has been approved.\nYour QR entry pass is attached below.\n\nSee you there!\n\n— Inv3rse Lifestyle Team`,
      attachments: [{ filename: `qr_${id}.png`, path: qrPath }],
    }, {
      headers: { Authorization: `Bearer ${RESEND_KEY}` },
    });

    console.log(`✅ QR sent to ${entry.email}`);
  } catch (err) {
    console.error("QR/email error:", err.message);
  }

  res.redirect("/admin");
});

// Start server
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
