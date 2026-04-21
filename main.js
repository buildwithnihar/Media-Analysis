"use strict";

// ============================================================
// IMPORTS
// ============================================================

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const WORKER_PATH = path.join(__dirname, "js", "scanWorker.js");

const { exportAuditCSV } = require("./js/admin/auditExport");
const {
  startRun,
  finishRun,
  getAllRuns,
  getAuditConfig,
  updateRunPartial,
  getRegionConfigPath,
  loadRegionConfig,
  detectRegion,
} = require("./js/auditStore");

// ============================================================
// STORAGE BASE
// NOTE: Hardcoded path — update to NAS or configurable root
//       before deploying to production.
// ============================================================

function resolveStorageBase() {
  const base =
    "C:\\Users\\Nihar.KP\\OneDrive - Consilio\\Desktop\\path\\MediaAnalysis\\Storage";

  try {
    fs.mkdirSync(base, { recursive: true });
    fs.accessSync(base, fs.constants.W_OK);
    console.log("Storage base resolved:", base);
    return base;
  } catch (err) {
    console.error("Storage base not accessible:", base, err.message);
    throw new Error(
      "Storage path is not accessible. Please check NAS connectivity or permissions.",
    );
  }
}

const BASE_DIR = resolveStorageBase();

try {
  fs.accessSync(BASE_DIR, fs.constants.W_OK);
  console.log("Storage accessible:", BASE_DIR);
} catch (err) {
  console.warn("Storage not writable, continuing with caution:", err.message);
}

// ============================================================
// STORAGE PATHS
// ============================================================

const DATA_DIR = path.join(BASE_DIR, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const RULES_FILE = path.join(DATA_DIR, "workflow_rules.json");
const SCAN_CONSTRAINTS_FILE = path.join(DATA_DIR, "scan_constraints.json");

// ============================================================
// RUN STATE
// ============================================================

let fullScanWasCancelled = false;
let limitedScanWasCancelled = false;

let LIMITED_DONE = false;
let FULL_DONE = false;
let FULL_CANCELLED = false;
let RUN_FINALIZED = false;

let CURRENT_RUN_ID = null;
let CURRENT_ALPHA_CODE = null;
let CURRENT_TASK_NUMBER = null;
let CURRENT_FULL_STATS = null;
let CURRENT_ANALYSIS_PATHS = [];
let CURRENT_DETECTED_WORKFLOWS = [];
let CURRENT_USED_WORKFLOWS = [];

// ============================================================
// WINDOW REFERENCES
// ============================================================

let mainWindow = null;
let sopWindows = [];

// ============================================================
// SCAN PROCESS REFERENCES
// ============================================================

let activeLimitedScanProcess = null;
let activeFullScanProcess = null;
let shuttingDown = false;

// ============================================================
// SECURITY SETTINGS
// ============================================================

app.commandLine.appendSwitch("disable-site-isolation-trials");
app.disableHardwareAcceleration();

// ============================================================
// UTILITY — PATH HELPERS
// ============================================================

/**
 * Normalises a path by collapsing mixed slashes into backslashes.
 */
function normalize(p) {
  if (typeof p !== "string") return "";
  return p.replace(/[/\\]+/g, "\\");
}

/**
 * Normalises a UNC or local path:
 *   - strips surrounding quotes
 *   - normalises slashes
 *   - removes trailing backslash
 *   - fixes single-leading-backslash UNC prefix to double-backslash
 */
function normalizeUNC(p) {
  if (typeof p !== "string") return "";

  let s = p.trim();
  s = s.replace(/^"+|"+$/g, "");
  s = s.replace(/[\/]+/g, "\\");
  s = s.replace(/\\+$/, "");

  if (s.startsWith("\\") && !s.startsWith("\\\\")) {
    s = "\\" + s;
  }

  return s;
}

/**
 * Returns true for valid UNC (\\server\share) or absolute local (C:\) paths.
 */
function isValidScanPath(p) {
  if (typeof p !== "string") return false;
  const s = p.trim();
  const isUNC = /^\\\\[^\\]+\\[^\\]+/.test(s);
  const isLocal = /^[a-zA-Z]:\\/.test(s);
  return isUNC || isLocal;
}

/**
 * Sanitises a string to safe alphanumeric characters for use in filenames
 * and shell arguments.
 */
function sanitizeString(str) {
  return (typeof str === "string" ? str : "").replace(/[^\w\-\. ]/g, "");
}

/**
 * Returns true when every element of arr is a non-empty string.
 */
function isSafeFolderList(arr) {
  return (
    Array.isArray(arr) &&
    arr.every((f) => typeof f === "string" && f.length > 0)
  );
}

/**
 * Returns an ISO timestamp with colons and dots replaced, safe for filenames.
 */
function getSafeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ============================================================
// UTILITY — FILE SYSTEM HELPERS
// ============================================================

function ensureDirs() {
  [DATA_DIR, BACKUP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function killAllScans() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (activeLimitedScanProcess?.kill) activeLimitedScanProcess.kill();
  if (activeFullScanProcess?.kill) activeFullScanProcess.kill();
  activeLimitedScanProcess = null;
  activeFullScanProcess = null;
}

// ============================================================
// RUN STATE MANAGEMENT
// ============================================================

function resetRunState() {
  LIMITED_DONE = false;
  FULL_DONE = false;
  FULL_CANCELLED = false;
  RUN_FINALIZED = false;

  limitedScanWasCancelled = false;
  fullScanWasCancelled = false;

  CURRENT_FULL_STATS = null;
  CURRENT_ANALYSIS_PATHS = [];
  CURRENT_DETECTED_WORKFLOWS = [];
  CURRENT_USED_WORKFLOWS = [];
}

/**
 * Persists a completed run once both limited and full scans have
 * settled (finished or cancelled).  Guards against double-writes
 * with RUN_FINALIZED.
 */
function finalizeRunIfReady() {
  if (!CURRENT_RUN_ID) return;
  if (RUN_FINALIZED) return;

  // Limited scan not yet settled — wait.
  if (!LIMITED_DONE && !limitedScanWasCancelled) return;

  // Limited scan was cancelled → entire run is cancelled.
  if (limitedScanWasCancelled) {
    RUN_FINALIZED = true;
    return;
  }

  // Limited completed + full cancelled → PARTIAL run.
  if (LIMITED_DONE && FULL_CANCELLED) {
    RUN_FINALIZED = true;
    finishRun({
      runId: CURRENT_RUN_ID,
      status: "COMPLETED",
      alphaCode: CURRENT_ALPHA_CODE,
      taskNumber: CURRENT_TASK_NUMBER,
      analysisPaths: CURRENT_ANALYSIS_PATHS,
      detectedWorkflows: CURRENT_DETECTED_WORKFLOWS,
      usedWorkflows: CURRENT_USED_WORKFLOWS,
      details: {
        limited: "completed",
        full: "completed",
        ...(CURRENT_FULL_STATS || {}),
      },
    });
    return;
  }

  // Both scans completed → full COMPLETED run.
  if (LIMITED_DONE && FULL_DONE) {
    RUN_FINALIZED = true;
    finishRun({
      runId: CURRENT_RUN_ID,
      status: "COMPLETED",
      alphaCode: CURRENT_ALPHA_CODE,
      taskNumber: CURRENT_TASK_NUMBER,
      analysisPaths: CURRENT_ANALYSIS_PATHS,
      detectedWorkflows: CURRENT_DETECTED_WORKFLOWS,
      usedWorkflows: CURRENT_USED_WORKFLOWS,
      details: CURRENT_FULL_STATS || {},
    });
  }
}

// ============================================================
// SCAN CONSTRAINTS
// ============================================================

function loadScanConstraints() {
  let maxDepth = 10;
  let maxFilesPerFolder = 20;

  try {
    if (fs.existsSync(SCAN_CONSTRAINTS_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(SCAN_CONSTRAINTS_FILE, "utf8"));
      if (typeof cfg.maxDepth === "number") maxDepth = cfg.maxDepth;
      if (typeof cfg.maxFilesPerFolder === "number")
        maxFilesPerFolder = cfg.maxFilesPerFolder;
    }
  } catch {}

  return { maxDepth, maxFilesPerFolder };
}

// ============================================================
// WORKFLOW BACKUP + LOGGING
// ============================================================

function backupWorkflowRules(existingRules, updatedBy) {
  ensureDirs();

  const safeUser = (updatedBy || "unknown").replace(/[^\w.-]/g, "_");
  const fileName = `workflow_rules_${getSafeTimestamp()}_${safeUser}.json`;
  const backupPath = path.join(BACKUP_DIR, fileName);

  fs.writeFileSync(backupPath, JSON.stringify(existingRules, null, 2), "utf8");
  console.log("Workflow rules backup created:", fileName);
}

function runFullScan() {
  const { maxDepth } = loadScanConstraints();

  return new Promise((resolve, reject) => {
    if (fullScanWasCancelled) return resolve(null);

    const worker = new Worker(WORKER_PATH, {
      workerData: {
        roots: CURRENT_ANALYSIS_PATHS,
        mode: "full",
        maxDepth,
        maxFiles: 0,
      },
    });

    // Store ref so cancelFullScan() can terminate the thread
    activeFullScanProcess = {
      pid: worker.threadId,
      kill: () => worker.terminate(),
    };

    worker.on("message", (msg) => {
      if (fullScanWasCancelled) return;

      if (msg.type === "progress") {
        // Both processed and totalSize are plain Numbers — safe to send over IPC
        mainWindow?.webContents.send("full-scan-progress", {
          processed: msg.processed,
          total: 0, // indeterminate mode (no pre-count)
        });
      } else if (msg.type === "done") {
        // totalSizeBytes is a plain Number — no BigInt conversion needed
        const totalSizeBytes = msg.totalSizeBytes || 0;

        CURRENT_FULL_STATS = {
          totalFiles: msg.totalFiles || 0,
          totalSizeBytes: totalSizeBytes,
          totalSizeGB: (totalSizeBytes / 1024 ** 3).toFixed(2),
          extensions: msg.extensions || [],
        };

        FULL_DONE = true;
        finalizeRunIfReady();
        resolve(CURRENT_FULL_STATS);
      } else if (msg.type === "error") {
        console.error("Full scan worker error:", msg.message);
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      activeFullScanProcess = null;
      if (!fullScanWasCancelled) reject(err);
    });

    worker.on("exit", (code) => {
      activeFullScanProcess = null;
      if (code !== 0 && !fullScanWasCancelled) {
        reject(new Error(`Full scan worker exited with code ${code}`));
      }
    });
  });
}

function runLimitedScan() {
  const { maxDepth, maxFilesPerFolder } = loadScanConstraints();

  return new Promise((resolve, reject) => {
    if (limitedScanWasCancelled) return resolve(null);

    const worker = new Worker(WORKER_PATH, {
      workerData: {
        roots: CURRENT_ANALYSIS_PATHS,
        mode: "limited",
        maxDepth,
        maxFiles: maxFilesPerFolder,
      },
    });

    activeLimitedScanProcess = {
      pid: worker.threadId,
      kill: () => worker.terminate(),
    };

    worker.on("message", (msg) => {
      if (limitedScanWasCancelled) return;

      if (msg.type === "done") {
        const folders = msg.folders || [];

        // Keep analysis paths in sync (folder_path strings)
        CURRENT_ANALYSIS_PATHS = folders.map((f) => f.folder_path);

        LIMITED_DONE = true;
        finalizeRunIfReady();
        resolve({ folders });
      } else if (msg.type === "error") {
        console.error("Limited scan worker error:", msg.message);
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      activeLimitedScanProcess = null;
      if (!limitedScanWasCancelled) reject(err);
    });

    worker.on("exit", (code) => {
      activeLimitedScanProcess = null;
      if (code !== 0 && !limitedScanWasCancelled) {
        reject(new Error(`Limited scan worker exited with code ${code}`));
      }
    });
  });
}

// ============================================================
// UPDATE cancelFullScan() and cancelLimitedScan() in main.js
// Workers are threads, not processes — use .kill() not taskkill
// ============================================================

function cancelFullScan() {
  if (!activeFullScanProcess) return false;

  console.log("Cancelling full scan worker");
  fullScanWasCancelled = true;
  FULL_CANCELLED = true;

  // Terminate the worker thread
  if (typeof activeFullScanProcess.kill === "function") {
    activeFullScanProcess.kill();
  }
  activeFullScanProcess = null;

  if (CURRENT_RUN_ID && !RUN_FINALIZED) {
    RUN_FINALIZED = true;
    finishRun({
      runId: CURRENT_RUN_ID,
      status: LIMITED_DONE ? "PARTIAL" : "CANCELLED",
      alphaCode: CURRENT_ALPHA_CODE,
      taskNumber: CURRENT_TASK_NUMBER,
      details: {
        limited: LIMITED_DONE ? "completed" : "cancelled",
        full: "cancelled",
      },
    });
  }

  return true;
}

function cancelLimitedScan() {
  if (!activeLimitedScanProcess) return false;

  console.log("Cancelling limited scan worker");
  limitedScanWasCancelled = true;

  if (typeof activeLimitedScanProcess.kill === "function") {
    activeLimitedScanProcess.kill();
  }
  activeLimitedScanProcess = null;

  return true;
}

// ============================================================
// WINDOW MANAGEMENT
// ============================================================

function createWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      devTools: true,
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("close", () => killAllScans());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openSOPWindow(url) {
  const sopWin = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "SOP Viewer",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  sopWin.loadURL(url);

  sopWindows.push(sopWin);
  sopWin.on("closed", () => {
    sopWindows = sopWindows.filter((w) => w !== sopWin);
  });
}

// ============================================================
// APP LIFECYCLE
// ============================================================

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  killAllScans();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => killAllScans());

process.on("exit", killAllScans);
process.on("SIGINT", killAllScans);
process.on("SIGTERM", killAllScans);

// ============================================================
// IPC — AUDIT STORE
// ============================================================

ipcMain.handle("audit:getAllRuns", () => getAllRuns());

ipcMain.handle("audit:exportCSV", () => exportAuditCSV());

ipcMain.handle("audit:getStorageConfig", () => {
  const cfg = getAuditConfig();
  const LOCAL_AUDIT_PATH = "C:\\ProgramData\\MediaTool\\audit";

  return {
    activeRoot: cfg.activeRoot,
    paths: [
      ...cfg.regions.map((r) => ({
        region: r.region,
        path: r.path,
        reachable: false,
        active: r.path === cfg.activeRoot,
      })),
      {
        region: "LOCAL",
        path: LOCAL_AUDIT_PATH,
        reachable: true,
        active: LOCAL_AUDIT_PATH === cfg.activeRoot,
      },
    ],
  };
});

// ============================================================
// IPC — REGION CONFIG
// ============================================================

ipcMain.handle("audit:getRegionConfig", () => {
  try {
    const configPath = getRegionConfigPath();

    if (!fs.existsSync(configPath)) {
      return { ok: false, error: "audit_regions.json not found" };
    }

    const raw = fs.readFileSync(configPath, "utf8");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Invalid JSON format" };
    }

    // Migrate old string-value format to object format.
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
    }

    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to load config" };
  }
});

ipcMain.handle("audit:updateRegionPath", (_e, { region, newPath }) => {
  try {
    if (!region || typeof region !== "string")
      return { ok: false, error: "Invalid region" };
    if (!newPath || typeof newPath !== "string")
      return { ok: false, error: "Invalid path" };

    const cleanedPath = newPath
      .trim()
      .replace(/^"+|"+$/g, "")
      .replace(/[\/]+/g, "\\")
      .replace(/\\+$/, "");

    const configPath = getRegionConfigPath();
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8"))
      : {};

    config[region.toUpperCase()] = {
      path: cleanedPath,
      updatedBy: process.env.USERNAME || "Unknown",
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("audit:getStoragePaths", () => {
  try {
    const configPath = getRegionConfigPath();
    const auditFolder = "C:\\ProgramData\\MediaTool\\audit";
    const auditFile = path.join(auditFolder, "audit.json");

    let regionPath = null;
    let region = null;

    try {
      const regionPaths = loadRegionConfig() || {};
      region = detectRegion() || "UNKNOWN";

      if (region && regionPaths[region]?.path) {
        regionPath = path.join(regionPaths[region].path, "audit.json");
      }
    } catch {
      // Ignore — region detection is best-effort.
    }

    return {
      ok: true,
      data: {
        configPath,
        localAuditPath: auditFile,
        regionAuditPath: regionPath,
        region: region || "UNKNOWN",
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC — PATH VALIDATION
// ============================================================

ipcMain.handle("validate-paths", (_e, paths) => {
  return paths.map((p) => {
    const normalized = normalizeUNC(p);

    let exists = false;
    try {
      exists = fs.existsSync(normalized);
    } catch {
      exists = false;
    }

    const isUNC = /^\\\\[^\\]+\\[^\\]+/.test(normalized);

    return {
      path: normalized,
      exists: exists || isUNC,
    };
  });
});

// ============================================================
// IPC — SCAN FILES + RUN INITIALISATION
// ============================================================

ipcMain.handle("save-scan-files", async (_, data) => {
  try {
    const alphaCode = sanitizeString(data.alphaCode);
    const taskNumber = sanitizeString(data.taskNumber);
    const folders = (data.folders || [])
      .map(normalizeUNC)
      .filter(isValidScanPath);

    console.log("Raw folders:", data.folders);
    console.log("Normalised folders:", folders);

    if (
      !alphaCode ||
      !taskNumber ||
      !isSafeFolderList(folders) ||
      folders.length === 0
    ) {
      return {
        ok: false,
        error:
          "Invalid or empty NAS folder paths. Please use UNC paths like \\\\SERVER\\Share",
      };
    }

    const user = process.env.USERNAME || process.env.USER || "UNKNOWN";

    resetRunState();

    CURRENT_ANALYSIS_PATHS = folders;
    CURRENT_RUN_ID = crypto.randomUUID();
    CURRENT_ALPHA_CODE = alphaCode;
    CURRENT_TASK_NUMBER = taskNumber;

    startRun({ runId: CURRENT_RUN_ID, user, alphaCode, taskNumber });

    const { maxDepth, maxFilesPerFolder } = loadScanConstraints();

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC — SCAN EXECUTION + CANCELLATION
// ============================================================

ipcMain.handle("run-scan-limited", async () => runLimitedScan());

ipcMain.handle("run-full-scan", async () => runFullScan());

ipcMain.handle("cancel-scan-limited", () => ({ ok: cancelLimitedScan() }));

ipcMain.handle("cancel-scan-full", () => ({ ok: cancelFullScan() }));

// ============================================================
// IPC — SCAN SETTINGS
// ============================================================

ipcMain.handle("save-scan-settings", async (_event, scanSettings) => {
  try {
    ensureDirs();

    const cleanSettings = {
      maxDepth: Math.min(Number(scanSettings.maxDepth) || 1, 25),
      maxFilesPerFolder: Math.min(
        Number(scanSettings.maxFilesPerFolder) || 1,
        500,
      ),
      lastUpdatedAt: scanSettings.lastUpdatedAt || Date.now(),
      updatedBy: scanSettings.updatedBy || "Admin",
    };

    fs.writeFileSync(
      SCAN_CONSTRAINTS_FILE,
      JSON.stringify(cleanSettings, null, 2),
      "utf8",
    );

    return { ok: true };
  } catch (err) {
    console.error("Failed to save scan settings:", err);
    throw err;
  }
});

ipcMain.handle("load-scan-settings", async () => {
  try {
    if (!fs.existsSync(SCAN_CONSTRAINTS_FILE)) return null;
    return JSON.parse(fs.readFileSync(SCAN_CONSTRAINTS_FILE, "utf8"));
  } catch (err) {
    console.error("Failed to load scan settings:", err);
    return null;
  }
});

// ============================================================
// IPC — SOP VIEWER
// ============================================================

ipcMain.handle("open-sop", async (_event, sopPath) => {
  if (typeof sopPath !== "string" || !sopPath.trim()) return;

  const cleaned = sopPath.trim().replace(/^"+|"+$/g, "");
  console.log("Opening SOP:", cleaned);

  if (/^https?:\/\//i.test(cleaned)) {
    openSOPWindow(cleaned);
  } else {
    await shell.openPath(cleaned);
  }
});

// ============================================================
// IPC — WORKFLOW MANAGEMENT
// ============================================================

ipcMain.handle("workflow-load", async () => {
  try {
    ensureDirs();

    const workflows = fs.existsSync(RULES_FILE)
      ? JSON.parse(fs.readFileSync(RULES_FILE, "utf8"))
      : [];

    const scanProfile = fs.existsSync(SCAN_CONSTRAINTS_FILE)
      ? JSON.parse(fs.readFileSync(SCAN_CONSTRAINTS_FILE, "utf8"))
      : { maxDepth: 25, maxFilesPerFolder: 500 };

    return { ok: true, workflows, scanProfile };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("workflow-save", async (_event, data) => {
  try {
    ensureDirs();

    // Back up existing rules before overwriting.
    if (fs.existsSync(RULES_FILE)) {
      const existingRules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
      const updatedBy =
        data?.workflows?.[0]?.updatedBy || process.env.USERNAME || "Admin";

      backupWorkflowRules(existingRules, updatedBy);
    }

    // Strip scan-config keys from workflow objects before persisting.
    const workflows = Array.isArray(data.workflows)
      ? data.workflows.map(({ scanConfig, scanProfile, ...cleanWF }) => cleanWF)
      : [];

    fs.writeFileSync(RULES_FILE, JSON.stringify(workflows, null, 2), "utf8");

    if (data.scanProfile) {
      fs.writeFileSync(
        SCAN_CONSTRAINTS_FILE,
        JSON.stringify(
          {
            maxDepth: data.scanProfile.maxDepth,
            maxFilesPerFolder: data.scanProfile.maxFilesPerFolder,
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    return { ok: true };
  } catch (err) {
    console.error("workflow-save failed:", err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("update-used-workflows", (_e, workflows) => {
  if (!CURRENT_RUN_ID) return { ok: false };
  if (!Array.isArray(workflows)) return { ok: false };

  const normalized = workflows
    .filter((w) => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim().toLowerCase());

  if (normalized.length === 0) return { ok: true };

  CURRENT_USED_WORKFLOWS = normalized;

  updateRunPartial({ runId: CURRENT_RUN_ID, usedWorkflows: normalized });

  return { ok: true };
});

ipcMain.handle("finalize-run", (_e, payload) => {
  if (payload.detectedWorkflows) {
    CURRENT_DETECTED_WORKFLOWS = payload.detectedWorkflows;
  }

  if (
    Array.isArray(payload.usedWorkflows) &&
    payload.usedWorkflows.length > 0
  ) {
    CURRENT_USED_WORKFLOWS = payload.usedWorkflows.map((w) =>
      typeof w === "string" ? w.trim().toLowerCase() : w,
    );
  }

  if (payload.analysisPaths) CURRENT_ANALYSIS_PATHS = payload.analysisPaths;
  if (payload.details) CURRENT_FULL_STATS = payload.details;

  finishRun({
    runId: CURRENT_RUN_ID,
    status: "COMPLETED",
    detectedWorkflows: CURRENT_DETECTED_WORKFLOWS,
    usedWorkflows: CURRENT_USED_WORKFLOWS,
    analysisPaths: CURRENT_ANALYSIS_PATHS,
    details: CURRENT_FULL_STATS,
  });

  return { ok: true };
});
