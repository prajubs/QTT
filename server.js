// -------------------- 📌 Imports -------------------- //
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const pdf2table = require("pdf2table");
const XLSX = require("xlsx");
const xmlbuilder = require("xmlbuilder");
const axios = require("axios");
const nodemailer = require("nodemailer");
const db = require("./db"); // ✅ SQLite connection
require("dotenv").config();

// -------------------- 📌 App Setup -------------------- //
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "mysecretkey123";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------- 📌 File Uploads -------------------- //
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// -------------------- 📌 Serve Static Frontend -------------------- //
// app.use(express.static(path.join(__dirname, "public"))); // Put your HTML inside /public

// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "public", "index.html"));
// });

const publicDir = path.join(__dirname); 
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// -------------------- 📌 Signup -------------------- //
app.post("/signup", (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const query = `INSERT INTO users (username, email, passwordHash) VALUES (?, ?, ?)`;

  db.run(query, [username, email, passwordHash], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ success: false, message: "Email already registered" });
      }
      console.error("❌ DB Insert Error:", err.message);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    res.json({ success: true, message: "Account created successfully" });
  });
});

// -------------------- 📌 Login -------------------- //
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email & password required" });
  }

  const query = `SELECT * FROM users WHERE email = ?`;
  db.get(query, [email], (err, user) => {
    if (err) {
      console.error("❌ DB Fetch Error:", err.message);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const isMatch = bcrypt.compareSync(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { username: user.username, email: user.email },
      SECRET_KEY,
      { expiresIn: "1h" }
    );

    res.json({
      success: true,
      token,
      username: user.username,
      email: user.email,
      message: "Login successful",
    });
  });
});

// -------------------- 📌 Forgot Password -------------------- //
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // from .env
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
});

app.post("/forgot-password", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: "DB error" });
    if (!user) return res.status(400).json({ success: false, message: "Email not found" });

    const resetToken = jwt.sign({ email }, SECRET_KEY, { expiresIn: "15m" });
    const resetLink = `${process.env.CLIENT_URL || "http://localhost:5500"}/reset.html?token=${resetToken}`;

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset Link",
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password (valid 15 minutes).</p>`,
    });

    res.json({ success: true, message: "Password reset link sent to your email" });
  });
});

// -------------------- 📌 Reset Password -------------------- //
app.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: "Token & newPassword required" });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const email = decoded.email;

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    const query = `UPDATE users SET passwordHash = ? WHERE email = ?`;

    db.run(query, [passwordHash, email], function (err) {
      if (err) {
        console.error("❌ DB Update Error:", err.message);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      if (this.changes === 0) {
        return res.status(400).json({ success: false, message: "User not found" });
      }
      res.json({ success: true, message: "Password updated successfully" });
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid or expired token" });
  }
});

// -------------------- 📌 PDF → Excel -------------------- //
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const excelPath = path.join(uploadDir, "output.xlsx");

    pdf2table.parse(pdfBuffer, async (err, rows) => {
      if (err) {
        console.error("❌ PDF extraction error:", err);
        return res.status(500).json({ success: false, message: "Failed to extract tables" });
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("PDF Data");
      rows.forEach((row) => sheet.addRow(row));

      // Auto-adjust column widths
      sheet.columns.forEach((col) => {
        let maxLength = 10;
        col.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.value) maxLength = Math.max(maxLength, cell.value.toString().length);
        });
        col.width = maxLength + 2;
      });

      await workbook.xlsx.writeFile(excelPath);

      fs.unlinkSync(req.file.path); // cleanup
      res.json({ success: true, message: "Converted to Excel with structure", file: "output.xlsx" });
    });
  } catch (err) {
    console.error("❌ PDF upload error:", err.message);
    res.status(500).json({ success: false, message: "Conversion failed" });
  }
});

// -------------------- 📌 Serve Excel -------------------- //
app.get("/download-excel", (req, res) => {
  const filePath = path.join(uploadDir, "output.xlsx");
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ message: "File not found" });
  }
});

// -------------------- 📌 Export Excel → Tally XML -------------------- //
app.get("/export-tally", async (req, res) => {
  try {
    const excelFile = path.join(uploadDir, "output.xlsx");
    if (!fs.existsSync(excelFile)) {
      return res.status(400).send("Excel file not found. Please upload PDF first.");
    }

    const workbook = XLSX.readFile(excelFile);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let xml = xmlbuilder.create("ENVELOPE");
    xml.ele("HEADER").ele("TALLYREQUEST", "Import Data").up().up()
      .ele("BODY")
      .ele("IMPORTDATA")
      .ele("REQUESTDESC")
      .ele("REPORTNAME", "All Masters").up().up()
      .ele("REQUESTDATA");

    sheetData.forEach((row) => {
      let tallyMsg = xml.ele("TALLYMESSAGE");
      let ledger = tallyMsg.ele("LEDGER");
      Object.keys(row).forEach((key) => ledger.ele(key.toUpperCase(), row[key]));
    });

    const finalXML = xml.end({ pretty: true });

    const response = await axios.post("http://localhost:9000", finalXML, {
      headers: { "Content-Type": "text/xml" },
    });

    res.send(`✅ Exported to Tally Prime! Response: ${response.data}`);
  } catch (err) {
    console.error("❌ Export error:", err.message);
    res.status(500).send("❌ Failed to export to Tally Prime");
  }
});

// -------------------- 📌 Start Server -------------------- //
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
