// preload.js
"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const os = require("os");

console.log("🔥 PRELOAD LOADED FROM:", __filename);

// ==============================
// SAFE VALIDATION HELPERS
// ==============================
const safeObj = (input) =>
  input && typeof input === "object" ? JSON.parse(JSON.stringify(input)) : {};

const safeString = (val) => (typeof val === "string" ? val : "");

const safeInvoke = (channel, payload) =>
  ipcRenderer
    .invoke(channel, payload)
    .then(safeObj)
    .catch((err) => ({ ok: false, error: String(err) }));

function validateScanData(data) {
  if (!data || typeof data !== "object") return {};
  return {
    alphaCode: safeString(data.alphaCode),
    taskNumber: safeString(data.taskNumber),
    folders: Array.isArray(data.folders) ? data.folders.map(safeString) : [],
  };
}

// ==============================
// ELECTRON API
// ==============================
contextBridge.exposeInMainWorld("electronAPI", {
  // Audit
  finalizeRun: (data) => ipcRenderer.invoke("finalize-run", data),
  updateUsedWorkflows: (workflows) =>
    ipcRenderer.invoke("update-used-workflows", workflows),
  auditAPI: {
    getAllRuns: () => ipcRenderer.invoke("audit:getAllRuns"),
  },

  // Scan lifecycle
  saveScanFiles: (data) =>
    safeInvoke("save-scan-files", validateScanData(data)),
  runScanLimited: () => safeInvoke("run-scan-limited"),
  runFullScan: () => safeInvoke("run-full-scan"),
  validatePaths: (paths) => safeInvoke("validate-paths", paths),

  // Scan cancellation
  cancelScanLimited: () => safeInvoke("cancel-scan-limited"),
  cancelScanFull: () => safeInvoke("cancel-scan-full"),

  // Workflow rules
  loadWorkflows: () => safeInvoke("workflow-load"),
  saveWorkflows: (data) => safeInvoke("workflow-save", safeObj(data)),

  // SOP opener
  openSOP: (path) => {
    if (typeof path === "string" && path.trim()) {
      ipcRenderer.invoke("open-sop", path);
    }
  },
});

// ==============================
// SCAN SETTINGS
// ==============================
contextBridge.exposeInMainWorld("scanAPI", {
  saveScanSettings: (settings) =>
    ipcRenderer.invoke("save-scan-settings", settings),
  loadScanSettings: () => ipcRenderer.invoke("load-scan-settings"),
});

// ==============================
// FULL SCAN PROGRESS
// ==============================
let progressListenerAttached = false;

contextBridge.exposeInMainWorld("scanProgressAPI", {
  onFullScanProgress: (callback) => {
    if (progressListenerAttached) return;
    progressListenerAttached = true;
    ipcRenderer.on("full-scan-progress", (_e, payload) => callback(payload));
  },
});

// ==============================
// AUDIT CONFIG
// ==============================
contextBridge.exposeInMainWorld("auditConfigAPI", {
  getRegionConfig: () => safeInvoke("audit:getRegionConfig"),
  getStoragePaths: () => ipcRenderer.invoke("audit:getStoragePaths"),
  updateRegionPath: (data) => safeInvoke("audit:updateRegionPath", data),
  getAuditStatus: () => safeInvoke("audit:getStatus"),
});

contextBridge.exposeInMainWorld("auditExportAPI", {
  exportCSV: () => ipcRenderer.invoke("audit:exportCSV"),
});

// ==============================
// SYSTEM API
// ==============================
contextBridge.exposeInMainWorld("systemAPI", {
  getUserName: () => os.userInfo().username,
});
