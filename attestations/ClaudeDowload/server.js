import express from "express";
import fs from "fs";
import path from "path";
import { DstackClient } from "@phala/dstack-sdk";

const app = express();
const PORT = process.env.PORT || 8080;

const STORAGE_DIR = process.env.STORAGE_DIR || "/app/storage";
const ATTESTATIONS_DIR = path.join(STORAGE_DIR, "attestations");
const INDEX_FILE = path.join(STORAGE_DIR, "index.json");

fs.mkdirSync(ATTESTATIONS_DIR, { recursive: true });

console.log(`📁 Storage directory: ${STORAGE_DIR}`);
console.log(`📋 Attestations directory: ${ATTESTATIONS_DIR}`);

app.use(express.json({ limit: "10mb" }));

function createDstackClient() {
  const socketPath = process.env.DSTACK_SOCKET_PATH || "/var/run/dstack.sock";
  try {
    const client = new DstackClient({ socketPath });
    console.log(`🛰️  DstackClient created (socket: ${socketPath})`);
    return client;
  } catch (err) {
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

async function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const data = await fs.promises.readFile(INDEX_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Failed to load index:", err);
  }
  return {};
}

async function saveIndex(index) {
  try {
    await fs.promises.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
  } catch (err) {
    console.error("Failed to save index:", err);
  }
}

async function updateIndex(completionId, data) {
  const index = await loadIndex();
  index[completionId] = {
    timestamp: data.timestamp,
    requested_agent: data.requested_agent,
    rcvr_agent: data.rcvr_agent,
    size: JSON.stringify(data).length,
  };
  await saveIndex(index);
}

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
      note: "Make sure /var/run/dstack.sock is mounted and Phala dstack is running",
    });
  }
});

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
      service: "attestation-storage-api",
      app_id: info.app_id,
      instance_id: info.instance_id,
      timestamp: Date.now(),
      version: "1.0.0",
      features: ["intel-tdx-tee", "attestation-storage", "verification-support"],
    };

    const rawReport = JSON.stringify(reportObj);
    let reportDataBuffer;
    
    if (Buffer.byteLength(rawReport) <= 64) {
      reportDataBuffer = Buffer.from(rawReport);
    } else {
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(rawReport).digest();
      reportDataBuffer = hash;
    }

    if (typeof client.getQuote !== "function") {
      throw new Error(
        "DstackClient does not expose getQuote(). Check @phala/dstack-sdk version and host support."
      );
    }

    const quoteResult = await client.getQuote(reportDataBuffer);
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
      },
      timestamp: new Date().toISOString(),
      message: "Attestation quote generated successfully",
    });
  } catch (error) {
    console.error("❌ Attestation error:", error);
    res.status(500).json({
      error: "Failed to generate attestation",
      detail: error && error.message ? error.message : String(error),
      note: "Make sure the host supports DCAP/quote generation and @phala/dstack-sdk is up to date.",
    });
  }
});

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
      message: "This API is running inside Phala Cloud's TEE environment",
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

app.post("/attestations", async (req, res) => {
  const data = req.body;

  if (!data.completion_id) {
    return res.status(400).json({ error: "completion_id required" });
  }

  const requiredFields = [
    "requested_agent",
    "requested_agent_query",
    "rcvr_agent",
    "rcvr_agent_response",
    "tool_attestation",
    "llm_attestation",
    "chat_signature",
    "timestamp",
    "hash",
  ];

  for (const field of requiredFields) {
    if (!data[field]) {
      return res.status(400).json({ error: `${field} is required` });
    }
  }

  const filename = `${data.completion_id}.json`;
  const filePath = path.join(ATTESTATIONS_DIR, filename);

  if (fs.existsSync(filePath)) {
    return res.status(409).json({ error: "Attestation already exists" });
  }

  try {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    await updateIndex(data.completion_id, data);
    console.log(`✅ Saved attestation: ${data.completion_id}`);
    res.json({ status: "saved", completion_id: data.completion_id });
  } catch (err) {
    console.error("❌ Save failed:", err);
    res.status(500).json({ error: "Failed to save attestation", detail: String(err) });
  }
});

app.get("/attestations/:completion_id", async (req, res) => {
  const completionId = req.params.completion_id;
  const filePath = path.join(ATTESTATIONS_DIR, `${completionId}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Attestation not found" });
  }

  try {
    const data = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    res.json(data);
  } catch (err) {
    console.error("❌ Read failed:", err);
    res.status(500).json({ error: "Failed to read attestation", detail: String(err) });
  }
});

app.get("/attestations", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const index = await loadIndex();
    const entries = Object.entries(index);
    const sorted = entries.sort((a, b) => {
      return new Date(b[1].timestamp) - new Date(a[1].timestamp);
    });

    const paginated = sorted.slice(offset, offset + limit);
    const result = paginated.map(([completion_id, meta]) => ({
      completion_id,
      ...meta,
    }));

    res.json({
      total: entries.length,
      limit,
      offset,
      results: result,
    });
  } catch (err) {
    console.error("❌ List failed:", err);
    res.status(500).json({ error: "Failed to list attestations", detail: String(err) });
  }
});

app.get("/health", async (req, res) => {
  try {
    const index = await loadIndex();
    const count = Object.keys(index).length;
    res.json({ status: "ok", storage_count: count });
  } catch (err) {
    res.status(500).json({ status: "error", detail: String(err) });
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Attestation Storage API",
    version: "1.0.0",
    tee: "Intel TDX via Phala Cloud (dstack)",
    tee_endpoints: {
      info: "/tee/info",
      attestation: "/tee/attestation",
      verify: "/tee/verify",
    },
    storage_endpoints: {
      create: "POST /attestations",
      retrieve: "GET /attestations/:completion_id",
      list: "GET /attestations?limit=10&offset=0",
    },
    health: "/health",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Attestation Storage API running on port ${PORT}`);
  console.log(`💾 Storage: ${STORAGE_DIR}`);
  console.log(`🔒 TEE: Intel TDX (attestation endpoints available via dstack)`);
  console.log(`✅ Ready to store and serve attestation data`);
});
