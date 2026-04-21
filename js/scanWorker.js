"use strict";

// ============================================================
// WORKER THREAD — Filesystem Scanner
// ⚠  This file must sit at the PROJECT ROOT (same level as
//    main.js), NOT inside js/ — browser scripts in js/ are
//    served to the renderer where require() is undefined.
//
// In main.js reference it as:
//   const WORKER_PATH = path.join(__dirname, 'scanWorker.js');
//
// Uses fs.opendirSync (maps to FindFirstFileW on Windows)
// which gives Dirent objects with type already known —
// no extra stat call needed just to tell file vs directory.
// ============================================================

// Safety guard: if somehow loaded in a browser context, bail immediately
if (typeof require === "undefined" || typeof process === "undefined") {
  throw new Error(
    "scanWorker.js must run as a Node.js Worker Thread, not in a browser context. Move it to the project root.",
  );
}

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const { roots, mode, maxDepth, maxFiles } = workerData;

// ── Counters (plain Number throughout — no BigInt mixing) ────
let processed = 0;
let totalSize = 0; // plain Number in bytes
const extSet = new Set();

// Report progress to main thread every N files
const BATCH = 3000;

// ============================================================
// SAFE SIZE HELPER
// Uses plain statSync (no bigint flag) so the .size property
// is always a regular JS Number. On files under ~9 petabytes
// this is perfectly precise. Catches EPERM / ENOENT silently.
// ============================================================
function getSize(fullPath) {
  try {
    return fs.statSync(fullPath).size; // always a Number
  } catch {
    return 0; // Number zero
  }
}

// ============================================================
// FULL SCAN
// Iterative BFS — no recursion, no stack overflow on deep trees.
// opendirSync + readSync is the fastest Node.js filesystem API:
//   - One syscall per directory (FindFirstFileW loop on Windows)
//   - Dirent carries isFile()/isDirectory() from the OS for free
//   - No extra stat to determine entry type
// ============================================================
function fullScan(roots) {
  const queue = [...roots]; // stack of directory strings

  while (queue.length > 0) {
    const dir = queue.pop();
    let handle;

    try {
      handle = fs.opendirSync(dir);
    } catch {
      // Access denied or broken path — skip silently
      continue;
    }

    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        const full = dir + "\\" + entry.name;

        if (entry.isDirectory()) {
          queue.push(full);
        } else if (entry.isFile()) {
          processed++;

          // Extension — path.extname already handles edge cases
          const ext = path.extname(entry.name).toLowerCase();
          if (ext) extSet.add(ext);

          // Size — plain Number, no BigInt
          totalSize += getSize(full);

          // Throttled progress report
          if (processed % BATCH === 0) {
            parentPort.postMessage({
              type: "progress",
              processed,
              totalSize, // plain Number, safe over IPC
            });
          }
        }
      }
    } finally {
      // Always close the directory handle
      try {
        handle.closeSync();
      } catch {}
    }
  }

  // Final done message
  parentPort.postMessage({
    type: "done",
    totalFiles: processed,
    totalSizeBytes: totalSize, // plain Number
    extensions: [...extSet],
  });
}

// ============================================================
// LIMITED SCAN
// BFS with depth cap + per-folder file sample cap.
// Collects file metadata for workflow detection.
// ============================================================
function limitedScan(roots) {
  const results = [];

  // Queue items: { dir: string, depth: number }
  const queue = roots.map((r) => ({ dir: r, depth: 0 }));

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();

    if (depth > maxDepth) continue;

    const folderObj = { folder_path: dir, files: [] };
    let handle;

    try {
      handle = fs.opendirSync(dir);
    } catch {
      results.push(folderObj);
      continue;
    }

    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        const full = dir + "\\" + entry.name;

        if (entry.isDirectory()) {
          if (depth < maxDepth) {
            queue.push({ dir: full, depth: depth + 1 });
          }
        } else if (entry.isFile() && folderObj.files.length < maxFiles) {
          // Only stat for the file size — still a plain Number
          let sizeKB = 0;
          try {
            sizeKB = Math.round(fs.statSync(full).size / 1024);
          } catch {}

          folderObj.files.push({
            name: entry.name,
            path: full,
            sizeKB,
          });
        }
      }
    } finally {
      try {
        handle.closeSync();
      } catch {}
    }

    results.push(folderObj);
  }

  parentPort.postMessage({
    type: "done",
    folders: results,
  });
}

// ============================================================
// DISPATCH
// ============================================================
try {
  if (mode === "full") {
    fullScan(roots);
  } else {
    limitedScan(roots);
  }
} catch (err) {
  // Surface any unexpected error back to main thread
  parentPort.postMessage({
    type: "error",
    message: err.message || String(err),
  });
}
