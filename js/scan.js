/* scan.js — Save → Scan workflow */

(() => {
  "use strict";

  // ============================================================
  // SHORTHAND
  // ============================================================

  const $id = (id) => document.getElementById(id);

  // ============================================================
  // MODULE STATE
  // ============================================================

  let SCAN_DATA = [];
  let CURRENT_PAGE = 1;
  let ROWS_PER_PAGE = 10;
  let fullScanProgressListenerAttached = false;
  let lastProgressUpdate = 0;
  let scanInProgress = false;
  let INVALID_PATHS_CACHE = [];
  let limitedScanStartTime = 0;
  let fullScanStartTime = 0;
  let limitedScanCancelled = false;
  let fullScanCancelled = false;

  // Each call to runFileAnalysisFlow() increments this.
  // Every async callback captures the value at launch time and
  // bails out if it no longer matches — preventing stale runs
  // from writing counts or UI state over a newer scan.
  let scanGeneration = 0;

  const PROGRESS_UI_INTERVAL = 200; // ms throttle for progress bar updates

  const CURRENT_USER = window.systemAPI?.getUserName?.() || "UNKNOWN";

  // ============================================================
  // CANCEL BUTTON HELPERS
  // ============================================================

  function showCancel(id) {
    const btn = $id(id);
    if (btn) {
      btn.style.display = "inline-flex";
      btn.disabled = false;
    }
  }

  function hideCancel(id) {
    const btn = $id(id);
    if (btn) btn.style.display = "none";
  }

  // ============================================================
  // WORKFLOW DATA LOADER
  // ============================================================

  async function loadAdminWorkflowJSON() {
    try {
      if (!window.electronAPI?.loadWorkflows) {
        console.error("electronAPI.loadWorkflows not available");
        window.WORKFLOW_DATA = [];
        return;
      }

      const res = await window.electronAPI.loadWorkflows();
      window.WORKFLOW_DATA = Array.isArray(res?.workflows) ? res.workflows : [];
    } catch (err) {
      console.error("Failed to load workflows:", err);
      window.WORKFLOW_DATA = [];
    }
  }

  // ============================================================
  // WORKFLOW STATE RESET
  // ============================================================

  function resetWorkflowStateForNewScan() {
    const workflowResult = $id("workflowResult");
    if (workflowResult) workflowResult.innerHTML = "";

    const sopBox = $id("sopLinksContainer");
    if (sopBox) sopBox.innerHTML = "";

    window.lastDetectedWorkflows = [];
    window.SYSTEM_DETECTED_WORKFLOWS = [];

    if (typeof window.resetWorkflowDetection === "function") {
      window.resetWorkflowDetection();
    }

    const infoNotice = $id("workflowInfoNotice");
    if (infoNotice) infoNotice.style.display = "none";

    const overlayNotice = $id("overlaySystemNotice");
    if (overlayNotice) overlayNotice.style.display = "none";
  }

  // ============================================================
  // FOLDER NAME COLLECTOR (exposed globally)
  // ============================================================

  window.collectAllFolderNames = function (tree) {
    const folders = new Set();

    function walk(node) {
      if (!node) return;

      if (node.type === "folder" || node.isDirectory) {
        if (node.path || node.name) {
          const last = (node.path || node.name)
            .split(/\\+/g)
            .pop()
            .toLowerCase();
          folders.add(last);
        }
      }

      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    }

    walk(tree);
    return [...folders];
  };

  // ============================================================
  // SCAN STATUS HELPERS
  // ============================================================

  function setScanStatus(message, color = "") {
    const el = $id("scanStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = color;
  }

  function clearScanStatus() {
    setScanStatus("");
  }

  // ============================================================
  // FULL SCAN UI
  // ============================================================

  function resetFullScanUI() {
    const statusEl = $id("fullScanStatus");
    const progressEl = $id("fullScanProgress");
    const resultEl = $id("fullScanResult");

    if (statusEl) {
      statusEl.textContent = "⏳ File counting analysis is running…";
      statusEl.style.color = "green";
    }

    if (progressEl) {
      progressEl.style.display = "block";
      progressEl.style.visibility = "visible";
      progressEl.style.opacity = "1";

      const bar = progressEl.querySelector(".scan-progress-bar");
      if (bar) {
        bar.style.width = "0%";
        bar.textContent = "0%";
      }
    }

    if (resultEl) resultEl.style.display = "none";
  }

  function updateFullScanUI(stats) {
    window.LAST_FULL_SCAN_STATS = {
      totalFiles: stats.totalFiles ?? 0,
      totalSizeBytes: stats.totalSizeBytes ?? 0,
    };

    const bar = document.querySelector(".scan-progress-bar");
    if (bar) {
      bar.classList.remove("indeterminate");
      bar.style.width = "100%";
    }

    const progressEl = $id("fullScanProgress");
    if (progressEl) progressEl.style.display = "none";

    const resultEl = $id("fullScanResult");
    if (resultEl) resultEl.style.display = "block";

    const statusEl = $id("fullScanStatus");
    if (statusEl) {
      if (!stats?.totalFiles) {
        statusEl.textContent =
          "⚠ Unable to perform file count analysis. No files were detected.";
        statusEl.style.color = "orange";
      } else {
        statusEl.textContent =
          "✔ File counting analysis completed successfully.";
        statusEl.style.color = "green";
      }
    }

    const tf = $id("totalFiles");
    if (tf) tf.textContent = stats.totalFiles ?? "—";

    const bytes = Number(stats.totalSizeBytes) || 0;
    const gb = bytes / (1024 * 1024 * 1024);

    const gbEl = $id("totalSizeGB");
    if (gbEl) gbEl.textContent = gb.toFixed(2) + " GB";

    const bytesEl = $id("totalSizeBytes");
    if (bytesEl) bytesEl.textContent = bytes.toLocaleString();

    renderExtensions(stats.extensions);

    window.LAST_SCANNED_EXTENSIONS = Array.isArray(stats.extensions)
      ? [...stats.extensions]
      : [];
  }

  // ============================================================
  // RESULTS TABLE
  // ============================================================

  function showViewDetailsButton(show) {
    const btn = $id("showResultsBtn");
    if (btn) btn.style.display = show ? "inline-block" : "none";
  }

  function hideResultsTable() {
    const old = $id("scanResultsContainer");
    if (old) old.remove();
  }
  window.hideResultsTable = hideResultsTable;

  function mountResultsContainer() {
    hideResultsTable();

    const tpl = $id("scanResultsTemplate");
    if (!tpl) return null;

    const frag = tpl.content.cloneNode(true);
    const containerDiv = frag.firstElementChild;
    const anchor = $id("showResultsBtn");

    anchor?.parentNode?.insertBefore(containerDiv, anchor.nextSibling);

    return $id("scanResultsContainer");
  }

  function renderRowsIntoTable(items) {
    const tbody = $id("scanResultsContainer")?.querySelector("tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const tpl = $id("fileRowTemplate");

    items.forEach((row, idx) => {
      const frag = tpl.content.cloneNode(true);
      const tr = frag.querySelector("tr");

      if (row.highlight) tr.classList.add("workflow-highlight");

      tr.querySelector(".col-index").textContent =
        idx + 1 + (CURRENT_PAGE - 1) * ROWS_PER_PAGE;
      tr.querySelector(".col-folder").textContent = row.folder_path || "";
      tr.querySelector(".col-name").textContent = row.name || "";
      tr.querySelector(".col-path").textContent = row.path || "";
      tr.querySelector(".col-size").textContent =
        row.sizeKB ?? row.sizekb ?? "";

      tbody.appendChild(tr);
    });
  }

  function updatePaginationUI() {
    const container = $id("scanResultsContainer");
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(SCAN_DATA.length / ROWS_PER_PAGE));

    container.querySelector(".pageInfo").textContent =
      `Page ${CURRENT_PAGE} / ${totalPages}`;
    container.querySelector(".prevPageBtn").disabled = CURRENT_PAGE <= 1;
    container.querySelector(".nextPageBtn").disabled =
      CURRENT_PAGE >= totalPages;
  }

  function attachPaginationHandlers() {
    const container = $id("scanResultsContainer");
    if (!container) return;

    const prev = container.querySelector(".prevPageBtn");
    const next = container.querySelector(".nextPageBtn");
    const rowsSelect = container.querySelector(".rowsPerPage");
    const closeBtn = container.querySelector(".closeResultsBtn");

    if (![10, 25, 50, 100].includes(Number(ROWS_PER_PAGE))) ROWS_PER_PAGE = 10;

    rowsSelect.value = ROWS_PER_PAGE;

    prev.addEventListener("click", () => {
      if (CURRENT_PAGE > 1) {
        CURRENT_PAGE--;
        refreshTable();
      }
    });

    next.addEventListener("click", () => {
      const totalPages = Math.ceil(SCAN_DATA.length / ROWS_PER_PAGE);
      if (CURRENT_PAGE < totalPages) {
        CURRENT_PAGE++;
        refreshTable();
      }
    });

    rowsSelect.addEventListener("change", () => {
      ROWS_PER_PAGE = Number(rowsSelect.value);
      CURRENT_PAGE = 1;
      refreshTable();
    });

    closeBtn.addEventListener("click", hideResultsTable);
  }

  function refreshTable() {
    if (!SCAN_DATA.length) return hideResultsTable();

    const totalPages = Math.ceil(SCAN_DATA.length / ROWS_PER_PAGE);
    if (CURRENT_PAGE > totalPages) CURRENT_PAGE = 1;

    const start = (CURRENT_PAGE - 1) * ROWS_PER_PAGE;
    const slice = SCAN_DATA.slice(start, start + ROWS_PER_PAGE);

    renderRowsIntoTable(slice);
    updatePaginationUI();
  }

  function openResultsTable() {
    if (!SCAN_DATA.length) {
      setScanStatus(
        "⚠ Scan completed but no files matched the criteria.",
        "orange",
      );
      return;
    }

    mountResultsContainer();
    attachPaginationHandlers();
    refreshTable();
  }

  // ============================================================
  // EXTENSIONS RENDERER
  // ============================================================

  function renderExtensions(extArray) {
    const box = $id("extensionsBox");
    const toggleBtn = $id("toggleExtensionsBtn");

    if (!box || !toggleBtn) return;

    box.innerHTML = "";

    if (!Array.isArray(extArray) || extArray.length === 0) {
      box.textContent = "—";
      toggleBtn.style.display = "none";
      return;
    }

    const sortedExts = [...extArray].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    const MAX_VISIBLE = 20;
    let expanded = false;

    sortedExts.forEach((ext, index) => {
      const pill = document.createElement("span");
      pill.className = "extension-pill";
      pill.textContent = ext;

      if (index >= MAX_VISIBLE) {
        pill.style.display = "none";
        pill.dataset.hidden = "true";
      }

      box.appendChild(pill);
    });

    if (sortedExts.length > MAX_VISIBLE) {
      toggleBtn.style.display = "inline-block";
      toggleBtn.textContent = `+ ${sortedExts.length - MAX_VISIBLE} more`;
    } else {
      toggleBtn.style.display = "none";
      return;
    }

    toggleBtn.onclick = () => {
      expanded = !expanded;

      box.classList.toggle("expanded", expanded);

      [...box.children].forEach((pill) => {
        if (pill.dataset.hidden === "true") {
          pill.style.display = expanded ? "inline-flex" : "none";
        }
      });

      toggleBtn.textContent = expanded
        ? "Show less"
        : `+ ${sortedExts.length - MAX_VISIBLE} more`;
    };
  }

  // ============================================================
  // WARNING RENDERERS
  // ============================================================

  function renderInvalidPathWarnings() {
    const warnBox = $id("scanWarnings");
    if (!warnBox) return;

    const filtered = (INVALID_PATHS_CACHE || []).filter(
      (p) => p && !p.startsWith("\\"),
    );

    if (!filtered.length) {
      warnBox.innerHTML = "";
      return;
    }

    warnBox.innerHTML = `
      <div style="color:red; margin-bottom:8px;">
        ❌ <b>Invalid local folder path(s):</b><br>
        ${filtered.map((p) => `• ${p}`).join("<br>")}
      </div>
    `;
  }

  function warnMissingFolders(userFolders, foundFolders) {
    const warnBox = $id("scanWarnings");
    if (!warnBox) return;

    const normalizePath = (p) =>
      p
        .replace(/[/\\]+/g, "\\")
        .replace(/\\+$/, "")
        .trim()
        .toLowerCase();

    const invalidSet = new Set((INVALID_PATHS_CACHE || []).map(normalizePath));

    const user = userFolders
      .map(normalizePath)
      .filter((p) => !invalidSet.has(p));
    const found = foundFolders.map((f) => normalizePath(f.folder_path || ""));

    const missing = user.filter(
      (userPath) =>
        !found.some(
          (foundPath) =>
            foundPath.startsWith(userPath) || userPath.startsWith(foundPath),
        ),
    );

    if (!missing.length) return;

    warnBox.innerHTML += `
      <div style="color:orange; margin-top:6px;">
        ⚠ <b>Below folders were not found during scanning:</b><br>
        ${missing.map((m) => `• ${m}`).join("<br>")}
      </div>
    `;
  }

  // ============================================================
  // SCAN DATA PROCESSING
  // ============================================================

  function flattenScanFolders(folders) {
    if (!Array.isArray(folders) || folders.length === 0) {
      console.warn("flattenScanFolders: no folders to flatten");
      return [];
    }

    const out = [];

    folders.forEach((folder) => {
      const base = folder.folder_path || folder.path || "";
      const files = folder.files || [];

      files.forEach((file) => {
        out.push({
          folder_path: base,
          name: file.name || "",
          path: file.path || file.fullpath || "",
          sizeKB: file.sizeKB ?? file.sizekb ?? "",
          highlight: null,
          workflows: [],
          ruleScore: 0,
          highlightRank: Infinity,
        });
      });
    });

    return out;
  }

  /**
   * Builds a searchable index from flattened scan rows.
   * Each entry mirrors its source row by reference so mutations
   * (highlight, ruleScore, etc.) propagate back automatically.
   */
  function buildFileIndex(scanRows) {
    return scanRows.map((row, idx) => {
      const name = (row.name || "").toLowerCase();
      const path = (row.path || "").toLowerCase();
      const folder = (row.folder_path || "").toLowerCase();

      return {
        id: idx,
        row,
        name,
        path,
        folder,
        ext: name.includes(".") ? name.split(".").pop() : "",
        searchable: `${name} ${path} ${folder}`,
      };
    });
  }

  // ============================================================
  // WORKFLOW DETECTION (V2)
  // ============================================================

  function matchConditionAgainstFile(file, cond) {
    const pattern = cond.pattern.toLowerCase();
    const type = (cond.type || "keyword").toLowerCase();

    switch (type) {
      case "extension":
        return file.ext === pattern;

      case "regex":
        try {
          return new RegExp(pattern, "i").test(file.searchable);
        } catch {
          return false;
        }

      case "keyword":
      default:
        return file.searchable.includes(pattern);
    }
  }

  function evaluateRuleAgainstFile(file, rule) {
    const conditions = rule.conditions || [];
    if (!conditions.length) return false;

    let result = null;

    for (const cond of conditions) {
      const pattern = (cond.pattern || "").toLowerCase();
      const type = (cond.type || "keyword").toLowerCase();
      let matched = false;

      switch (type) {
        case "extension":
          matched = file.ext === pattern;
          break;

        case "regex":
          try {
            const rx = new RegExp(pattern, "i");
            matched =
              rx.test(file.name) || rx.test(file.path) || rx.test(file.folder);
          } catch {
            matched = false;
          }
          break;

        case "keyword":
        default:
          matched = file.searchable.includes(pattern);
          break;
      }

      if (result === null) {
        result = matched;
      } else {
        const logic = (cond.logic || "AND").toUpperCase();
        result = logic === "OR" ? result || matched : result && matched;
      }
    }

    return !!result;
  }

  function evaluateRuleAtDatasetLevel(files, rule) {
    let result = null;
    const contributingFileIds = new Set();

    for (const cond of rule.conditions || []) {
      const matchedFiles = files.filter((file) =>
        matchConditionAgainstFile(file, cond),
      );

      const matched = matchedFiles.length > 0;
      matchedFiles.forEach((f) => contributingFileIds.add(f.id));

      if (result === null) {
        result = matched;
      } else {
        const logic = (cond.logic || "AND").toUpperCase();
        result = logic === "OR" ? result || matched : result && matched;
      }
    }

    return { matched: !!result, contributingFileIds };
  }

  function detectWorkflowsV2(scanRows, fileIndex) {
    if (!Array.isArray(window.WORKFLOW_DATA)) return [];

    const workflowResults = [];

    // Reset file-level metadata before scoring.
    scanRows.forEach((r) => {
      r.workflows = [];
      r.ruleScore = 0;
      r.highlight = null;
      r.highlightRank = Infinity;
    });

    window.WORKFLOW_DATA.forEach((wf) => {
      let workflowScore = 0;

      (wf.rules || []).forEach((rule) => {
        const { matched, contributingFileIds } = evaluateRuleAtDatasetLevel(
          fileIndex,
          rule,
        );

        if (!matched) return;

        workflowScore += rule.score || 0;

        fileIndex.forEach((file) => {
          if (!contributingFileIds.has(file.id)) return;

          file.row.ruleScore = Math.max(
            file.row.ruleScore || 0,
            rule.score || 0,
          );

          if (!file.row.workflows.includes(wf.workflow)) {
            file.row.workflows.push(wf.workflow);
          }

          if (!file.row.highlight || rule.score > file.row.highlightRank) {
            file.row.highlight = wf.workflow;
            file.row.highlightRank = rule.score;
          }
        });
      });

      if (workflowScore > 0) {
        workflowResults.push({
          workflow: wf.workflow,
          totalScore: workflowScore,
          tierSummary: wf.rules.map((r) => r.tier),
        });
      }
    });

    return workflowResults;
  }

  // ============================================================
  // OVERLAY ENFORCEMENT
  // ============================================================

  function enforceOverlayFromDetectedWorkflows() {
    if (!Array.isArray(window.WORKFLOW_DATA)) return;

    const overlayRequiredSet = new Set(
      window.WORKFLOW_DATA.filter((wf) => wf.overlayRequired === true).map(
        (wf) => wf.workflow,
      ),
    );

    const matched = window.SYSTEM_DETECTED_WORKFLOWS.filter((wf) =>
      overlayRequiredSet.has(wf),
    );

    if (!matched.length) return;

    const overlaySelect = $id("overlayRequired");
    if (overlaySelect) {
      overlaySelect.value = "Yes";
      overlaySelect.dispatchEvent(new Event("change"));
    }

    showOverlaySystemNotice(matched);
  }

  function showOverlaySystemNotice(workflows) {
    const box = $id("overlaySystemNotice");
    if (!box) return;

    box.innerHTML = `
      <span class="workflow-info-icon">⚠️</span>
      <div>
        <strong>Overlay Required (System Detected)</strong><br>
        The following workflow(s) require overlay:<b>${workflows.join(", ")}</b>
      </div>
    `;

    box.style.display = "flex";
  }

  // ============================================================
  // MAIN SCAN FLOW
  // ============================================================

  async function runFileAnalysisFlow() {
    try {
      resetWorkflowStateForNewScan();

      // ---- If a scan is already running, cancel it and restart ----
      if (scanInProgress) {
        console.warn("Scan already running — cancelling and restarting");

        limitedScanCancelled = true;
        fullScanCancelled = true;

        try {
          await window.electronAPI.cancelScanLimited().catch(() => {});
          await window.electronAPI.cancelScanFull().catch(() => {});
        } catch {}

        hideCancel("cancelFileAnalysisBtn");
        hideCancel("cancelFileCountingBtn");
        hideResultsTable();
        showViewDetailsButton(false);
        setScanStatus("🔄 Restarting scan…", "orange");

        // Allow Windows to fully terminate the PowerShell process tree.
        await new Promise((r) => setTimeout(r, 500));
      }

      // ---- Reset UI ----
      const warnBox = $id("scanWarnings");
      if (warnBox) warnBox.innerHTML = "";

      INVALID_PATHS_CACHE = [];
      clearScanStatus();
      hideResultsTable();
      showViewDetailsButton(false);

      // ---- Validate form (before locking) ----
      if (!window.validateScanConfig?.()) {
        if (typeof window.focusFirstValidationError === "function") {
          window.focusFirstValidationError();
        }
        return;
      }

      // ---- Lock scan + reset cancellation flags ----
      scanInProgress = true;
      limitedScanCancelled = false;
      fullScanCancelled = false;

      // Capture the generation for this run — any async callback that
      // finds a different value knows it belongs to a cancelled run.
      const myGeneration = ++scanGeneration;

      // ---- Read inputs ----
      const alpha = $id("alphaCode").value.trim();
      const task = $id("taskNumber").value.trim();
      const folders = (window.getFolderPaths?.() || [])
        .map((p) => p.replace(/\/+/g, "\\").replace(/\\+$/, "").trim())
        .filter(Boolean);

      if (!folders.length) {
        setScanStatus("⚠ No folder paths provided.", "red");
        return;
      }

      // ---- Validate paths ----
      const validation = await window.electronAPI.validatePaths(folders);

      INVALID_PATHS_CACHE = validation
        .filter((v) => {
          const p = v.path || "";
          return p && !v.exists && !p.startsWith("\\");
        })
        .map((v) => v.path || "")
        .filter((p) => p && !p.startsWith("\\"));

      console.log(INVALID_PATHS_CACHE, "INVALID_PATHS_CACHE");

      if (INVALID_PATHS_CACHE.length) {
        renderInvalidPathWarnings();
        setScanStatus(
          "⚠ Some local paths are invalid. Network paths will still be processed.",
          "orange",
        );
      }

      // ---- Save scan config ----
      setScanStatus("⏳ Saving scan files...");

      let saveResult;
      try {
        saveResult = await window.electronAPI.saveScanFiles({
          alphaCode: alpha,
          taskNumber: task,
          folders,
        });
      } catch (err) {
        setScanStatus("❌ Save failed: " + err.message, "red");
        return;
      }

      if (!saveResult?.ok) {
        setScanStatus("❌ " + saveResult.error, "red");
        return;
      }

      // ---- Start scans ----
      setScanStatus("⏳ Running scan...");

      const fullCard = $id("fullScanCard");
      if (fullCard) fullCard.style.display = "block";
      resetFullScanUI();

      // Full scan fires and is NOT awaited — runs in parallel with limited scan.
      fullScanCancelled = false;
      fullScanStartTime = Date.now();
      showCancel("cancelFileCountingBtn");

      const fullScanPromise = window.electronAPI
        .runFullScan()
        .then((res) => {
          if (myGeneration !== scanGeneration) return null; // stale run — discard
          if (!res || res.ok === false) return null;
          const stats = res.data ?? res;
          if (!fullScanCancelled && stats) updateFullScanUI(stats);
          return stats;
        })
        .catch((err) => {
          if (myGeneration !== scanGeneration) return null; // stale run — discard
          if (!fullScanCancelled) console.error("Full scan failed:", err);
          return null;
        })
        .finally(() => {
          if (myGeneration === scanGeneration)
            hideCancel("cancelFileCountingBtn");
        });

      // Limited scan is awaited.
      limitedScanCancelled = false;
      limitedScanStartTime = Date.now();
      showCancel("cancelFileAnalysisBtn");

      const scanResult = await window.electronAPI.runScanLimited();
      hideCancel("cancelFileAnalysisBtn");

      // If a newer run has already started, silently drop this result.
      if (myGeneration !== scanGeneration) return;

      if (
        limitedScanCancelled ||
        !scanResult ||
        !Array.isArray(scanResult.folders)
      ) {
        setScanStatus("❌ Scan cancelled or failed.", "orange");
        return;
      }

      // ---- Ensure workflow rules are loaded before detection ----
      if (
        !Array.isArray(window.WORKFLOW_DATA) ||
        !window.WORKFLOW_DATA.length
      ) {
        await loadAdminWorkflowJSON();
      }

      // ---- Post-process results ----
      SCAN_DATA = flattenScanFolders(scanResult.folders);
      const FILE_INDEX = buildFileIndex(SCAN_DATA);
      const detectedWorkflows = detectWorkflowsV2(SCAN_DATA, FILE_INDEX);

      if (limitedScanCancelled) return;

      // Sort: highlighted → higher rule score → workflow priority → alphabetical.
      SCAN_DATA.sort((a, b) => {
        if (!!a.highlight !== !!b.highlight) return a.highlight ? -1 : 1;
        if ((b.ruleScore || 0) !== (a.ruleScore || 0))
          return (b.ruleScore || 0) - (a.ruleScore || 0);
        if ((a.highlightRank || Infinity) !== (b.highlightRank || Infinity))
          return (a.highlightRank || Infinity) - (b.highlightRank || Infinity);
        return (a.name || "").localeCompare(b.name || "");
      });

      if ($id("scanResultsContainer")) {
        CURRENT_PAGE = 1;
        refreshTable();
      }

      window.SYSTEM_DETECTED_WORKFLOWS = detectedWorkflows.map(
        (w) => w.workflow,
      );

      enforceOverlayFromDetectedWorkflows();

      if (!window.WORKFLOW_DATA?.length) {
        console.warn("WORKFLOW_DATA missing at apply time");
      }

      if (window.WORKFLOW_UI_READY) {
        window.applyDetectedWorkflows({ workflows: detectedWorkflows });
      } else {
        console.warn("Workflow UI not ready. Detected workflows cached.");
        window.PENDING_DETECTED_WORKFLOWS = detectedWorkflows;
      }

      CURRENT_PAGE = 1;
      showViewDetailsButton(true);
      openResultsTable();

      warnMissingFolders(folders, scanResult.folders);

      if (!SCAN_DATA.length) {
        setScanStatus(
          "⚠ Unable to perform analysis. No valid files found in selected path.",
          "orange",
        );
        return;
      }

      setScanStatus("✔ Workflow analysis complete.", "green");

      // ---- Wait for full scan stats, then finalise audit ----
      const fullStats = await fullScanPromise;

      const workflowSelect = $id("workflowUsed");
      let usedWorkflows = [];
      if (workflowSelect?.tomselect) {
        const selected = workflowSelect.tomselect.getValue();
        usedWorkflows = Array.isArray(selected)
          ? selected
          : selected
            ? [selected]
            : [];
      }

      console.log("Full stats:", fullStats);
      console.log("Used workflows:", usedWorkflows);

      await window.electronAPI.finalizeRun({
        user: CURRENT_USER,
        alphaCode: alpha,
        taskNumber: task,
        machine: CURRENT_USER,

        detectedWorkflows: window.SYSTEM_DETECTED_WORKFLOWS || [],
        usedWorkflows,
        analysisPaths: folders,

        details: {
          totalFiles:
            fullStats?.totalFiles ??
            window.LAST_FULL_SCAN_STATS?.totalFiles ??
            0,

          totalSizeBytes:
            fullStats?.totalSizeBytes ??
            window.LAST_FULL_SCAN_STATS?.totalSizeBytes ??
            0,

          totalSizeGB: (
            (fullStats?.totalSizeBytes ??
              window.LAST_FULL_SCAN_STATS?.totalSizeBytes ??
              0) /
            (1024 * 1024 * 1024)
          ).toFixed(2),

          limited: limitedScanCancelled ? "Cancelled" : "Completed",
          full: fullScanCancelled ? "Cancelled" : "Completed",
        },
      });
    } catch (err) {
      console.error(err);
      setScanStatus("❌ Scan failed: " + err.message, "red");
    } finally {
      scanInProgress = false;
      console.log("Scan lock released");
    }
  }

  // ============================================================
  // BUTTON BINDINGS
  // ============================================================

  function bindScanButton() {
    const btn = $id("saveScanFilesBtn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      runFileAnalysisFlow();
    });
  }

  function bindShowResults() {
    const btn = $id("showResultsBtn");
    if (!btn) return;
    btn.addEventListener("click", openResultsTable);
  }

  function bindCancelButtons() {
    $id("cancelFileAnalysisBtn")?.addEventListener("click", async () => {
      limitedScanCancelled = true;

      await window.electronAPI.cancelScanLimited();

      hideCancel("cancelFileAnalysisBtn");
      setScanStatus("❌ File analysis cancelled by user.", "orange");
      showViewDetailsButton(false);
    });

    $id("cancelFileCountingBtn")?.addEventListener("click", async () => {
      fullScanCancelled = true;

      await window.electronAPI.cancelScanFull();

      const progressEl = $id("fullScanProgress");
      if (progressEl) {
        const bar = progressEl.querySelector(".scan-progress-bar");
        if (bar) {
          bar.style.width = bar.style.width || "0%";
          bar.textContent = "Cancelled";
        }
      }

      const statusEl = $id("fullScanStatus");
      if (statusEl) {
        statusEl.textContent = "❌ File counting cancelled by user.";
        statusEl.style.color = "orange";
      }

      hideCancel("cancelFileCountingBtn");
    });
  }

  // ============================================================
  // INITIALISATION
  // ============================================================

  document.addEventListener("DOMContentLoaded", () => {
    const workflowSelect = $id("workflowUsed");
    if (workflowSelect?.tomselect) {
      workflowSelect.tomselect.on("change", (value) => {
        const selected = Array.isArray(value) ? value : value ? [value] : [];
        console.log("Dynamic used workflows:", selected);
        window.electronAPI.updateUsedWorkflows(selected);
      });
    }

    bindScanButton();
    bindCancelButtons();
    bindShowResults();
    showViewDetailsButton(false);
  });

  // ============================================================
  // FULL SCAN PROGRESS LISTENER
  // Attached immediately (outside DOMContentLoaded) to avoid
  // race conditions with progress events arriving early.
  // ============================================================

  if (window.scanProgressAPI && !fullScanProgressListenerAttached) {
    fullScanProgressListenerAttached = true;

    window.scanProgressAPI.onFullScanProgress((payload) => {
      if (fullScanCancelled) return;
      if (!payload || typeof payload !== "object") return;

      const { processed = 0, total = 0 } = payload;

      const bar = document.querySelector(".scan-progress-bar");
      const statusEl = $id("fullScanStatus");
      if (!bar || !statusEl) return;

      const now = Date.now();
      if (now - lastProgressUpdate < PROGRESS_UI_INTERVAL) return;
      lastProgressUpdate = now;

      // Single-pass mode: total is unknown, show indeterminate bar.
      if (total === 0) {
        bar.classList.add("indeterminate");
        bar.style.width = "";
        bar.textContent = "";
        statusEl.textContent = `⏳ File counting… ${processed.toLocaleString()} files scanned`;
        return;
      }

      // Percentage mode (future-proof).
      const percent = Math.min(100, Math.round((processed / total) * 100));
      bar.style.width = percent + "%";
      bar.textContent = percent + "%";

      const elapsed = Math.max(1, (Date.now() - fullScanStartTime) / 1000);
      const remaining = Math.max(
        0,
        Math.round((elapsed / percent) * (100 - percent)),
      );

      statusEl.textContent = `⏳ File counting… ${processed.toLocaleString()} / ${total.toLocaleString()} files (~${remaining}s remaining)`;
    });
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.runFileAnalysisFlow = runFileAnalysisFlow;
})();
