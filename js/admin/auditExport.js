// BACKEND ONLY — used by main.js
const { dialog } = require("electron");
const fs = require("fs");
const os = require("os");
const { getAllRuns, getAuditConfig } = require("../auditStore");

function escapeCSV(val) {
  if (val === null || val === undefined) return "";

  const s = String(val);

  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

async function exportAuditCSV() {
  const runs = getAllRuns();
  const cfg = getAuditConfig();

  let activeRegion = cfg.activeRegion || "LOCAL";

  if (!runs.length) {
    return { ok: false, error: "No audit records found" };
  }

  const defaultName = `audit_${activeRegion.toLowerCase()}_${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export Audit (CSV)",
    defaultPath: defaultName,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  const metaLines = [
    "# Audit Export",
    `# Region: ${activeRegion}`,
    `# Audit Root: ${cfg.activeRoot}`,
    `# Exported At: ${new Date().toISOString()}`,
    "",
  ];

  const header = [
    "Run ID",
    "User",
    "Alpha Code",
    "Task Number",
    "Machine",
    "Region",
    "Detected Workflows",
    "Used Workflows",
    "Analysis Paths",
    "Status",
    "Started At (UTC)",
    "Finished At (UTC)",
    "Total Files",
    "Total Size (Bytes)",
    "Total Size (GB)",
    "Limited Status",
    "Full Status",
  ];

  const rows = runs.map((r) => [
    r.runId,
    r.user,
    r.alphaCode,
    r.taskNumber,
    r.machine,
    r.region,
    (r.detectedWorkflows || []).join("; "),
    (r.usedWorkflows || []).join("; "),
    (r.analysisPaths || []).join("; "),
    r.status,
    r.startedAtUTC,
    r.finishedAtUTC,
    r.details?.totalFiles ?? "",
    r.details?.totalSizeBytes ?? "",
    r.details?.totalSizeGB ?? "",
    r.details?.limited ?? "",
    r.details?.full ?? "",
  ]);

  const csv =
    metaLines.join("\n") +
    header.join(",") +
    "\n" +
    rows.map((row) => row.map(escapeCSV).join(",")).join("\n");

  fs.writeFileSync(filePath, csv, "utf8");

  return { ok: true, filePath };
}

module.exports = {
  exportAuditCSV,
};
