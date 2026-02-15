const fs = require("fs/promises");
const path = require("path");

const TMP_FILE = path.join("/tmp", "sawtooth-ai-sourcing.json");

function defaultState() {
  return { ai_queue: [], draft_products: [], products_dynamic: [] };
}

async function readTmpState() {
  try {
    const raw = await fs.readFile(TMP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ai_queue: Array.isArray(parsed.ai_queue) ? parsed.ai_queue : [],
      draft_products: Array.isArray(parsed.draft_products) ? parsed.draft_products : [],
      products_dynamic: Array.isArray(parsed.products_dynamic) ? parsed.products_dynamic : [],
    };
  } catch (_) {
    return defaultState();
  }
}

async function writeTmpState(state) {
  await fs.writeFile(TMP_FILE, JSON.stringify(state), "utf8");
}

function getBlobStoreOrNull() {
  let blobsModule = null;
  try {
    blobsModule = require("@netlify/blobs");
  } catch (_) {
    return null;
  }
  if (!blobsModule || typeof blobsModule.getStore !== "function") return null;
  try {
    return blobsModule.getStore("sawtooth-ai-sourcing");
  } catch (_) {
    return null;
  }
}

async function readBlobArray(key) {
  const store = getBlobStoreOrNull();
  if (!store) throw new Error("Blobs unavailable");
  const value = await store.get(key, { type: "json" });
  return Array.isArray(value) ? value : [];
}

async function writeBlobArray(key, value) {
  const store = getBlobStoreOrNull();
  if (!store) throw new Error("Blobs unavailable");
  await store.setJSON(key, Array.isArray(value) ? value : []);
}

async function readState() {
  try {
    return {
      ai_queue: await readBlobArray("ai_queue"),
      draft_products: await readBlobArray("draft_products"),
      products_dynamic: await readBlobArray("products_dynamic"),
    };
  } catch (_) {
    return readTmpState();
  }
}

async function writeState(state) {
  try {
    await writeBlobArray("ai_queue", state.ai_queue);
    await writeBlobArray("draft_products", state.draft_products);
    await writeBlobArray("products_dynamic", state.products_dynamic || []);
    return { backend: "blobs" };
  } catch (_) {
    await writeTmpState(state);
    return { backend: "tmp" };
  }
}

module.exports = {
  readState,
  writeState,
};
