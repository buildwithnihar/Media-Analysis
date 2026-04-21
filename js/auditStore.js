// auditStore.js — Machine-wide, multi-user safe audit store

"use strict";

// ============================================================
// IMPORTS
// ============================================================

const fs = require("fs");
const path = require("path");
const os = require("os");

// ============================================================
// CONFIG
// ============================================================

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 100;

// Set to true  → always writes to the local C:\ProgramData path (dev/test).
// Set to false → resolves path from audit_regions.json based on hostname (production).
const FORCE_LOCAL_AUDIT = true;

// NOTE: main.js imports this module as getAuditRoot but the export
// is named getAuditStatus. Both names refer to resolveAuditRootSafe.
// Keep both in the module.exports block below for compatibility.

// ============================================================
// BASE PATH + REGION CONFIG PATH
// ============================================================

const BASE_PATH =
  "C:\\Users\\Nihar.KP\\OneDrive - Consilio\\Desktop\\path\\MediaAnalysis\\Storage";

function getRegionConfigPath() {
  return path.join(BASE_PATH, "data", "audit_regions.json");
}

// ============================================================
// REGION CONFIG — LOAD + MIGRATE
// ============================================================

/**
 * Reads audit_regions.json from disk.
 * Automatically migrates entries that are plain strings (old format)
 * to the new { path, updatedBy, updatedAt } object format.
 * Returns an empty object (no crash) if the file is missing or invalid.
 */
function loadRegionConfig() {
  const configPath = getRegionConfigPath();

  if (!fs.existsSync(configPath)) {
    console.warn("audit_regions.json not found:", configPath);
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    let changed = false;

    Object.keys(parsed).forEach((region) => {
      if (typeof parsed[region] === "string") {
        parsed[region] = {
          path: parsed[region],
          updatedBy: "SYSTEM_MIGRATION",
          updatedAt: new Date().toISOString(),
        };
        changed = true;
      }
    });

    if (changed) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2));
      console.log("audit_regions.json migrated to new format");
    }

    return parsed;
  } catch (err) {
    console.error("Invalid audit_regions.json:", err.message);
    return {};
  }
}

// ============================================================
// REGION DETECTION
// ============================================================

/**
 * Derives the region code from the machine hostname.
 * Expects a prefix of two uppercase letters followed by one digit
 * (e.g. US1, UK1, AU1, DE1).
 * Returns null if the hostname does not match.
 */
function detectRegion() {
  const host = os.hostname().toUpperCase();
  const match = host.match(/^[A-Z]{2}\d/);
  return match ? match[0] : null;
}

// ============================================================
// AUDIT ROOT RESOLUTION
// ============================================================

/**
 * Resolves the writable audit directory for the current machine.
 *
 * In local/test mode (FORCE_LOCAL_AUDIT = true):
 *   always returns C:\ProgramData\MediaTool\audit
 *
 * In production mode (FORCE_LOCAL_AUDIT = false):
 *   resolves the path from audit_regions.json using the machine's
 *   region prefix.
 *
 * Returns { ok, region, path } on success or { ok, error, region, path: null } on failure.
 */
function resolveAuditRootSafe() {
  if (FORCE_LOCAL_AUDIT) {
    const testPath = "C:\\ProgramData\\MediaTool\\audit";

    try {
      fs.mkdirSync(testPath, { recursive: true });
      fs.accessSync(testPath, fs.constants.W_OK);
    } catch {
      return {
        ok: false,
        error: "Local audit path not writable.",
        region: "LOCAL",
        path: null,
      };
    }

    return { ok: true, region: "LOCAL", path: testPath };
  }

  // Production: resolve from region config.
  const regionPaths = loadRegionConfig();
  const region = detectRegion();

  if (!region) {
    return {
      ok: false,
      error: "Machine region not recognized.",
      region: "UNKNOWN",
      path: null,
    };
  }

  if (!regionPaths[region]) {
    return {
      ok: false,
      error: `No path configured for region ${region}.`,
      region,
      path: null,
    };
  }

  const regionPath = regionPaths[region]?.path;

  try {
    fs.mkdirSync(regionPath, { recursive: true });
    fs.accessSync(regionPath, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      error: "Configured region path not writable.",
      region,
      path: null,
    };
  }

  return { ok: true, region, path: regionPath };
}

// ============================================================
// AUDIT CONFIG (for IPC handler)
// ============================================================

function getAuditConfig() {
  const regionConfig = loadRegionConfig();
  const auditInfo = resolveAuditRootSafe();

  return {
    regions: Object.entries(regionConfig).map(([region, data]) => ({
      region,
      path: data?.path || "",
    })),
    activeRoot: auditInfo.path,
    activeRegion: auditInfo.region,
  };
}

// ============================================================
// AUDIT PATH HELPER
// ============================================================

/**
 * Returns the audit file and lock file paths for a given audit root.
 * Extracted to avoid the same path.join calls being duplicated
 * across all four public functions.
 */
function getAuditPaths(auditInfo) {
  return {
    auditFile: path.join(auditInfo.path, "audit.json"),
    lockFile: path.join(auditInfo.path, "audit.lock"),
  };
}

// ============================================================
// FILE LOCK HELPERS
// ============================================================

// Pre-allocated buffer for Atomics.wait — avoids allocating a new
// SharedArrayBuffer on every retry iteration.
const _lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * Acquires an exclusive file lock using O_EXCL (wx flag).
 * Retries every LOCK_RETRY_MS until LOCK_TIMEOUT_MS elapses.
 * Throws if the lock cannot be acquired within the timeout.
 */
function acquireLock(lockFile, start = Date.now()) {
  try {
    return fs.openSync(lockFile, "wx");
  } catch {
    if (Date.now() - start > LOCK_TIMEOUT_MS) {
      throw new Error(
        "Audit lock timeout — another process may be holding the lock.",
      );
    }
    Atomics.wait(_lockWaitBuffer, 0, 0, LOCK_RETRY_MS);
    return acquireLock(lockFile, start);
  }
}

function releaseLock(fd, lockFile) {
  try {
    if (fd) fs.closeSync(fd);
  } catch {}
  try {
    if (lockFile) fs.unlinkSync(lockFile);
  } catch {}
}

// ============================================================
// STORE READ / WRITE
// ============================================================

function readStore(auditFile) {
  try {
    return JSON.parse(fs.readFileSync(auditFile, "utf8"));
  } catch {
    return { runs: [] };
  }
}

function writeStore(auditFile, store) {
  fs.writeFileSync(auditFile, JSON.stringify(store, null, 2));
}

// ============================================================
// PUBLIC API — AUDIT OPERATIONS
// ============================================================

function startRun({
  runId,
  user,
  alphaCode,
  taskNumber,
  detectedWorkflows = [],
  usedWorkflows = [],
}) {
  const auditInfo = resolveAuditRootSafe();
  if (!auditInfo.ok) {
    console.warn("Audit disabled (startRun):", auditInfo.error);
    return;
  }

  const { auditFile, lockFile } = getAuditPaths(auditInfo);
  let fd;

  try {
    fd = acquireLock(lockFile);

    const store = readStore(auditFile);
    store.runs.push({
      runId,
      user,
      alphaCode: alphaCode || null,
      taskNumber: taskNumber || null,
      machine: os.hostname(),
      region: auditInfo.region,
      networkPath: auditInfo.path,
      detectedWorkflows,
      usedWorkflows,
      analysisPaths: [],
      startedAtUTC: new Date().toISOString(),
      finishedAtUTC: null,
      status: "RUNNING",
      details: {},
    });

    writeStore(auditFile, store);
  } catch (err) {
    console.error("Audit startRun failed:", err.message);
  } finally {
    releaseLock(fd, lockFile);
  }
}

function finishRun({
  runId,
  status,
  details,
  alphaCode,
  taskNumber,
  detectedWorkflows,
  usedWorkflows,
  analysisPaths,
}) {
  const auditInfo = resolveAuditRootSafe();
  if (!auditInfo.ok) {
    console.warn("Audit disabled (finishRun):", auditInfo.error);
    return;
  }

  const { auditFile, lockFile } = getAuditPaths(auditInfo);
  let fd;

  try {
    fd = acquireLock(lockFile);

    const store = readStore(auditFile);
    const run = store.runs.find((r) => r.runId === runId);
    if (!run) return;

    run.finishedAtUTC = new Date().toISOString();
    run.status = (status || "COMPLETED").toUpperCase();
    run.details = details || {};

    if (analysisPaths) run.analysisPaths = analysisPaths;
    if (alphaCode) run.alphaCode = alphaCode;
    if (taskNumber) run.taskNumber = taskNumber;

    if (Array.isArray(detectedWorkflows) && detectedWorkflows.length > 0) {
      // Merge with any workflows already recorded during startRun,
      // deduplicating case-insensitively.
      const merged = new Set([
        ...(run.detectedWorkflows || []).map((w) => w.trim().toLowerCase()),
        ...detectedWorkflows
          .filter((w) => typeof w === "string")
          .map((w) => w.trim().toLowerCase()),
      ]);
      run.detectedWorkflows = Array.from(merged);
    }

    if (Array.isArray(usedWorkflows)) {
      run.usedWorkflows = usedWorkflows.map((w) =>
        typeof w === "string" ? w.trim().toLowerCase() : w,
      );
    }

    writeStore(auditFile, store);
  } catch (err) {
    console.error("Audit finishRun failed:", err.message);
  } finally {
    releaseLock(fd, lockFile);
  }
}

function getAllRuns() {
  const auditInfo = resolveAuditRootSafe();
  if (!auditInfo.ok) return [];

  const { auditFile, lockFile } = getAuditPaths(auditInfo);
  let fd;

  try {
    fd = acquireLock(lockFile);

    const store = readStore(auditFile);
    return store.runs.sort(
      (a, b) => new Date(b.startedAtUTC) - new Date(a.startedAtUTC),
    );
  } catch (err) {
    console.error("Audit getAllRuns failed:", err.message);
    return [];
  } finally {
    releaseLock(fd, lockFile);
  }
}

function updateRunPartial({ runId, usedWorkflows }) {
  const auditInfo = resolveAuditRootSafe();
  if (!auditInfo.ok) return;

  const { auditFile, lockFile } = getAuditPaths(auditInfo);
  let fd;

  try {
    fd = acquireLock(lockFile);

    const store = readStore(auditFile);
    const run = store.runs.find((r) => r.runId === runId);
    if (!run) return;

    if (Array.isArray(usedWorkflows)) {
      run.usedWorkflows = usedWorkflows.map((w) =>
        typeof w === "string" ? w.trim().toLowerCase() : w,
      );
    }

    writeStore(auditFile, store);
  } catch (err) {
    console.error("Audit updateRunPartial failed:", err.message);
  } finally {
    releaseLock(fd, lockFile);
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  startRun,
  finishRun,
  getAllRuns,
  updateRunPartial,
  getAuditConfig,
  getAuditRoot: resolveAuditRootSafe, // alias used by main.js
  getAuditStatus: resolveAuditRootSafe, // alias used by admin.js IPC
  getRegionConfigPath,
  loadRegionConfig,
  detectRegion,
};
