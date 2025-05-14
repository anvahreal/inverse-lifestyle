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

// POST /submit
app.post("/submit", upload.single("paymentProof"), (req, res) => {
  const filePath = path.join(__dirname, "data.json");

  let data = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath);
      data = raw.length ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Failed to parse data.json, resetting.");
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      data = [];
    }
  }

  const { accountName, email, phone } = req.body;

  const exists = data.find(entry => entry.email === email || entry.phone === phone);
  if (exists) {
    return res.status(400).send("You've already registered with this phone or email.");
  }

  const formData = {
    accountName,
    email,
    phone,
    proof: req.file ? `/uploads/${req.file.filename}` : null,
    approved: false,
    qr: null
  };

  data.push(formData);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.redirect("/thankyou.html");
});

// Basic Auth Middleware for Admin
const adminAuth = (req, res, next) => {
  const auth = { login: "admin", password: "secret123" }; // 🔒 change this!
  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64").toString().split(":");

  if (login === auth.login && password === auth.password) return next();

  res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
  res.status(401).send("Authentication required.");
};

// GET /admin (Protected)
app.get("/admin", adminAuth, (req, res) => {
  const filePath = path.join(__dirname, "data.json");
  let data = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath);
      data = raw.length ? JSON.parse(raw) : [];
    } catch (err) {
      data = [];
    }
  }

  let html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <link rel="stylesheet" href="/assets/styles/styles.css" />
    <title>Admin Panel - Inv3rse Republik</title>
  </head>
  <body>
    <div class="overlay"></div>
    <main class="wrapper fade-in">
      <section class="content">
        <h1>Admin Panel</h1>
        <p>Manage all registered attendees below.</p>
      </section>
      <ul style="list-style: none; padding: 0;">`;

  data.forEach((entry, i) => {
    html += `
      <li style="margin-bottom: 30px; background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px;">
        <p><strong>${entry.accountName}</strong><br>
        ${entry.email} | ${entry.phone}</p>
        <p>Payment Proof:<br>
          <img src="${entry.proof}" alt="proof" style="max-width: 150px; border-radius: 8px;" />
        </p>
        ${entry.qr ? `<p>QR Code:<br><img src="${entry.qr}" alt="QR Code" style="max-width: 150px; border-radius: 8px;" /></p>` : ''}
        ${!entry.approved ? `
        <form action="/approve/${i}" method="POST">
          <button>Approve & Generate QR</button>
        </form>` : '<p><strong style="color: #66ff7f;">Approved</strong></p>'}
      </li>`;
  });

  html += `</ul></main></body></html>`;
  res.send(html);
});

// POST /approve/:id
app.post("/approve/:id", async (req, res) => {
  const id = req.params.id;
  const filePath = path.join(__dirname, "data.json");

  let data = [];
  try {
    const raw = fs.readFileSync(filePath);
    data = JSON.parse(raw);
  } catch {
    return res.status(500).send("Could not read data.");
  }

  if (!data[id]) return res.status(404).send("User not found.");

  data[id].approved = true;
  const userQRData = `${data[id].accountName} | ${data[id].email} | ${data[id].phone}`;

  const qrDir = path.join(__dirname, "public", "qrs");
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir);

  const qrPath = path.join(qrDir, `qr_${id}.png`);
  try {
    await QRCode.toFile(qrPath, userQRData);
    data[id].qr = `/qrs/qr_${id}.png`;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Send email with QR code (OPTIONAL)
    const emailData = {
      from: "noreply@inv3rse.com",
      to: data[id].email,
      subject: "Your QR Code for Event",
      text: `Hello ${data[id].accountName},\n\nYour registration has been approved. Please find your QR code attached.\n\nBest Regards,\nInv3rse Team`,
      attachments: [
        {
          filename: `qr_${id}.png`,
          path: qrPath,
        },
      ],
    };

    await axios.post("https://api.resend.com/emails", emailData, {
      headers: {
        Authorization: `Bearer re_jnmANYA9_EAzfJwMo7rn4rgksHmzJ8qLD`,
      },
    });

    console.log("Email sent to", data[id].email);
    res.redirect("/admin");
  } catch (err) {
    console.error("QR or email failed:", err);
    res.redirect("/admin");
  }
});

// Start server
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
