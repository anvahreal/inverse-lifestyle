const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

app.post("/submit", upload.single("paymentProof"), (req, res) => {
  const formData = {
    accountName: req.body.accountName,
    email: req.body.email,
    phone: req.body.phone,
    proof: req.file ? `/uploads/${req.file.filename}` : null,
    approved: false,
    qr: null
  };

  const filePath = path.join(__dirname, "data.json");
  let data = [];
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath));
  }
  data.push(formData);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  res.redirect("/thankyou.html");
});

app.get("/admin", (req, res) => {
  const data = JSON.parse(fs.readFileSync("data.json"));
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


app.post("/approve/:id", async (req, res) => {
  const id = req.params.id;
  const data = JSON.parse(fs.readFileSync("data.json"));
  data[id].approved = true;

  const userQRData = `${data[id].accountName} | ${data[id].email} | ${data[id].phone}`;
  const qrDir = path.join(__dirname, "public", "qrs");
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir);
  const qrPath = path.join(qrDir, `qr_${id}.png`);

  QRCode.toFile(qrPath, userQRData, async () => {
    data[id].qr = `/qrs/qr_${id}.png`;
    fs.writeFileSync("data.json", JSON.stringify(data, null, 2));

    // Sending email with the QR code as attachment
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

    try {
      // Send email via Resend API
      const response = await axios.post("https://api.resend.com/emails", emailData, {
        headers: {
          Authorization: `Bearer re_jnmANYA9_EAzfJwMo7rn4rgksHmzJ8qLD`,
        },
      });

      console.log("Email sent successfully:", response.data);
      res.redirect("/admin");
    } catch (error) {
      console.error("Error sending email:", error);
      res.redirect("/admin");
    }
  });
});

app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
