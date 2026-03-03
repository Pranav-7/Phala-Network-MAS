// server.mjs
// PDF API with TEE Attestation Support (updated to use DstackClient + /var/run/dstack.sock)

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import mime from "mime-types";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { DstackClient } from "@phala/dstack-sdk"; // <-- updated

const app = express();
const PORT = process.env.PORT || 8080;

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const SIGN_SECRET = process.env.SIGN_SECRET || "dev-sign-secret-not-safe";

console.log("🔐 Deriving AES encryption key from SIGN_SECRET...");

if (SIGN_SECRET === "dev-sign-secret-not-safe") {
  console.warn("⚠️  WARNING: Using default SIGN_SECRET! Change this in production!");
}

const AES_KEY = crypto.pbkdf2Sync(
  SIGN_SECRET,
  "pdf-storage-v1-salt",
  100000,
  32,
  "sha256"
);

console.log("✅ AES-256 key derived successfully (deterministic, survives restarts)");
console.log(`📁 Storage directory: ${STORAGE_DIR}`);

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// -----------------------------
// ENCRYPTION HELPERS
// -----------------------------
function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptBuffer(encBuffer) {
  const iv = encBuffer.slice(0, 12);
  const tag = encBuffer.slice(12, 28);
  const data = encBuffer.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// -----------------------------
// SIGNED URL HELPERS
// -----------------------------
function signData(data) {
  return crypto.createHmac("sha256", SIGN_SECRET).update(data).digest("hex");
}

function generateSignature(filename, expires) {
  return signData(`${filename}:${expires}`);
}

function verifySignature(filename, expires, signature) {
  const expected = generateSignature(filename, expires);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

function assertSignature(req, res, filename) {
  const { expires, sig } = req.query;

  if (!expires || !sig) {
    res.status(403).json({ error: "Signed URL required" });
    return false;
  }

  if (Date.now() > Number(expires)) {
    res.status(403).json({ error: "Signed URL expired" });
    return false;
  }

  if (!verifySignature(filename, expires, sig)) {
    res.status(403).json({ error: "Invalid signature" });
    return false;
  }

  return true;
}

// -----------------------------
// FILE NAME & MIME HELPERS
// -----------------------------
function isPdf(file) {
  const mt = file.mimetype || mime.lookup(file.originalname) || "";
  return mt === "application/pdf";
}

function safeFileName(originalName) {
  return originalName.replace(/[^\w.\-() ]+/g, "").replace(/\s+/g, "_");
}

// -----------------------------
// Dstack client helper
// -----------------------------
function createDstackClient() {
  // Allow overriding socket path via env var for local testing
  const socketPath = process.env.DSTACK_SOCKET_PATH || "/var/run/dstack.sock";

  // Some SDK versions accept options, some auto-detect socket; attempt to pass socketPath
  try {
    const client = new DstackClient({ socketPath });
    console.log(`🛰️  DstackClient created (socket: ${socketPath})`);
    return client;
  } catch (err) {
    // Fallback: try without options
    try {
      const client = new DstackClient();
      console.log("🛰️  DstackClient created (auto socket detection)");
      return client;
    } catch (err2) {
      console.error("❌ Failed to construct DstackClient:", err2);
      throw err2;
    }
  }
}

// -----------------------------
// 🆕 TEE ATTESTATION ENDPOINTS (using DstackClient)
// -----------------------------

// Get TEE information
app.get("/tee/info", async (req, res) => {
  let client;
  try {
    client = createDstackClient();
  } catch (err) {
    return res.status(500).json({
      error: "Failed to create DstackClient",
      detail: String(err),
      note: "Make sure /var/run/dstack.sock is mounted in docker-compose.yml",
    });
  }

  try {
    // Most SDK versions provide .info() that returns { app_id, instance_id, app_name, tcb_info }
    const info = await client.info();

    res.json({
      status: "success",
      tee: {
        app_id: info.app_id,
        instance_id: info.instance_id,
        app_name: info.app_name,
        tcb_info: info.tcb_info || info.tcb || null,
      },
      message: "TEE information retrieved successfully",
    });
  } catch (error) {
    console.error("❌ TEE info error:", error);
    res.status(500).json({
      error: "Failed to get TEE info",
      detail: error && error.message ? error.message : String(error),
      note:
        "Make sure /var/run/dstack.sock is mounted in docker-compose.yml and Phala dstack is running",
    });
  }
});

// Generate attestation quote
// inside server.mjs — replace /tee/attestation handler with this:

app.get("/tee/attestation", async (req, res) => {
  let client;
  try {
    client = createDstackClient();
  } catch (err) {
    return res.status(500).json({
      error: "Failed to create DstackClient",
      detail: String(err),
      note: "Make sure /var/run/dstack.sock is mounted in docker-compose.yml",
    });
  }

  try {
    const info = await client.info();
    const reportObj = {
      service: "pdf-secure-api",
      app_id: info.app_id,
      instance_id: info.instance_id,
      timestamp: Date.now(),
      version: "1.0.0",
      features: ["aes-256-gcm-encryption", "signed-urls", "intel-tdx-tee"],
    };

    const rawReport = JSON.stringify(reportObj);

    // Per docs: reportData must be <= 64 bytes. Hash if longer.
    let reportDataBuffer;
    if (Buffer.byteLength(rawReport) <= 64) {
      // pass as Buffer or string (<=64 bytes)
      reportDataBuffer = Buffer.from(rawReport);
    } else {
      // Hash to fit: SHA256 -> 32 bytes (safe)
      const hash = crypto.createHash("sha256").update(rawReport).digest();
      // Docs examples use the hash (32 bytes) — pass the raw bytes (not hex)
      reportDataBuffer = hash;
    }

    // Ensure getQuote exists
    if (typeof client.getQuote !== "function") {
      throw new Error(
        "DstackClient does not expose getQuote(). Check @phala/dstack-sdk version and host support."
      );
    }

    // Call documented method: getQuote(reportData)
    const quoteResult = await client.getQuote(reportDataBuffer);

    // quoteResult expected shape: { quote, event_log, vm_config, replayRtmrs? }
    const quote = quoteResult.quote || quoteResult.raw_quote || quoteResult;
    const event_log = quoteResult.event_log || quoteResult.eventLog || null;
    const vm_config = quoteResult.vm_config || quoteResult.vmConfig || null;

    res.json({
      status: "success",
      tee_info: {
        app_id: info.app_id,
        instance_id: info.instance_id,
        app_name: info.app_name,
      },
      attestation: {
        quote,
        event_log,
        vm_config,
        report_data_used: reportDataBuffer.toString("hex"),
        report_data_original_length: Buffer.byteLength(rawReport),
      },
      timestamp: new Date().toISOString(),
      message: "Attestation quote generated successfully",
    });
  } catch (error) {
    console.error("❌ Attestation error:", error);
    res.status(500).json({
      error: "Failed to generate attestation",
      detail: error && error.message ? error.message : String(error),
      note:
        "Make sure the host supports DCAP/quote generation and @phala/dstack-sdk is up to date.",
    });
  }
});


// Quick attestation check - simple endpoint
app.get("/tee/verify", async (req, res) => {
  let client;
  try {
    client = createDstackClient();
  } catch (err) {
    return res.status(500).json({
      error: "Failed to create DstackClient",
      detail: String(err),
      note: "Make sure /var/run/dstack.sock is mounted in docker-compose.yml",
    });
  }

  try {
    const info = await client.info();

    res.json({
      status: "verified",
      message: "This API appears to be running inside Phala Cloud's TEE environment",
      tee_type: "Intel TDX / Phala dstack",
      app_id: info.app_id,
      verified_by: "Phala Cloud",
      attestation_available: "/tee/attestation",
    });
  } catch (error) {
    console.error("❌ TEE verify error:", error);
    res.status(500).json({
      status: "error",
      message: "TEE verification failed",
      detail: error && error.message ? error.message : String(error),
    });
  }
});

// -----------------------------
// SIGNED URL GENERATION ENDPOINTS
// -----------------------------
app.get("/sign/upload", (req, res) => {
  const id = uuidv4();
  const name = safeFileName(req.query.name || "file.pdf");
  const filename = `${id}-${name}`;

  const expires = Date.now() + 5 * 60 * 1000;
  const sig = generateSignature(filename, expires);

  res.json({
    upload_url: `/upload/${filename}?expires=${expires}&sig=${sig}`,
    expires,
    filename,
  });
});

app.get("/sign/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const expires = Date.now() + 5 * 60 * 1000;
  const sig = generateSignature(filename, expires);

  res.json({
    download_url: `/pdf/${filename}?expires=${expires}&sig=${sig}`,
    expires,
    filename,
  });
});

app.get("/sign/delete/:filename", (req, res) => {
  const filename = req.params.filename;
  const expires = Date.now() + 5 * 60 * 1000;
  const sig = generateSignature(filename, expires);

  res.json({
    delete_url: `/pdf/${filename}?expires=${expires}&sig=${sig}`,
    expires,
    filename,
  });
});

// -----------------------------
// UPLOAD (SIGNED)
// -----------------------------
app.post("/upload/:filename", upload.single("file"), async (req, res) => {
  const filename = req.params.filename;

  if (!assertSignature(req, res, filename)) return;

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!isPdf(req.file))
    return res.status(400).json({ error: "Only PDF allowed" });

  const filePath = path.join(STORAGE_DIR, filename);

  try {
    const enc = encryptBuffer(req.file.buffer);
    await fs.promises.writeFile(filePath, enc, { flag: "wx" });
    console.log(`✅ Encrypted and saved: ${filename} (${enc.length} bytes)`);
    res.json({ status: "saved", filename });
  } catch (err) {
    console.error(`❌ Upload failed: ${err}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Upload failed", detail: String(err) });
    }
  }
});

// -----------------------------
// DOWNLOAD (SIGNED)
// -----------------------------
app.get("/pdf/:filename", async (req, res) => {
  const filename = req.params.filename;

  if (!assertSignature(req, res, filename)) return;

  const filePath = path.join(STORAGE_DIR, filename);

  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File not found" });

  try {
    const encBuffer = await fs.promises.readFile(filePath);
    const dec = decryptBuffer(encBuffer);
    console.log(`✅ Decrypted and serving: ${filename} (${dec.length} bytes)`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(dec);
  } catch (err) {
    console.error(`❌ Download failed: ${err}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed", detail: String(err) });
    }
  }
});

// -----------------------------
// DELETE (SIGNED)
// -----------------------------
app.delete("/pdf/:filename", async (req, res) => {
  const filename = req.params.filename;

  if (!assertSignature(req, res, filename)) return;

  const filePath = path.join(STORAGE_DIR, filename);

  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File not found" });

  try {
    await fs.promises.unlink(filePath);
    console.log(`🗑️  Deleted: ${filename}`);
    res.json({ status: "deleted", filename });
  } catch (err) {
    console.error(`❌ Delete failed: ${err}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Delete failed" });
    }
  }
});

// -----------------------------
// LIST (OPEN)
// -----------------------------
app.get("/files", async (req, res) => {
  try {
    const files = await fs.promises.readdir(STORAGE_DIR);
    const items = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.promises.stat(path.join(STORAGE_DIR, f));
        return { filename: f, size: stat.size, mtime: stat.mtime };
      })
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "Failed to list files" });
  }
});

// -----------------------------
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "PDF Secure Storage API",
    encryption: "AES-256-GCM",
    auth: "Signed URLs",
    key_type: "Deterministic (PBKDF2)",
    restart_safe: true,
    tee: "Intel TDX via Phala Cloud (dstack)",
    tee_endpoints: {
      info: "/tee/info",
      attestation: "/tee/attestation",
      verify: "/tee/verify",
    },
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PDF API running on port ${PORT}`);
  console.log(`🔐 Encryption: AES-256-GCM (deterministic key)`);
  console.log(`🔑 Authentication: HMAC-SHA256 signed URLs`);
  console.log(`💾 Storage: ${STORAGE_DIR}`);
  console.log(`✅ Restart-safe: Files will persist and remain decryptable`);
  console.log(`🔒 TEE: Intel TDX (attestation endpoints available via dstack)`);
});
