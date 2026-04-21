// admin.js — Template-driven admin panel (safe version)
// Keeps all original function and variable names.
// Prevent admin.js from running on index.html

// ============================================================
// MODULE-LEVEL HELPERS
// (defined outside DOMContentLoaded so they are available
//  as early utility functions if needed)
// ============================================================

function safe(on, event, fn) {
  if (on) on.addEventListener(event, fn);
}

function safeClick(on, fn) {
  if (on) on.onclick = fn;
}

// ============================================================
// MAIN
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // ----------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------

  const ADMIN_PIN = "1234";
  const SUPER_USER_PIN = "s1234";
  const AUTO_HIDE_MS = 30000;

  const REGION_LABELS = {
    AU1: "Australia",
    CA1: "Toronto",
    CH1: "Zurich",
    CN1: "Shanghai",
    DE1: "Frankfurt",
    FR1: "Paris",
    HK1: "Hong Kong",
    JP1: "Tokyo",
    UK1: "London",
    US1: "Chicago",
  };

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  let isSuperUser = false; // in-memory, resets on reload
  let workflows = [];
  let currentWF = null; // workflow index
  let currentRule = null; // rule index or null
  let currentAdminName = "Admin";
  let workflowSearchText = "";
  let ALL_AUDIT_RUNS = [];
  let auditChartInstance = null;

  // ----------------------------------------------------------
  // ELEMENT REFERENCES
  // ----------------------------------------------------------

  // Auth
  const loginSection = document.getElementById("adminLoginSection");
  const adminWelcome = document.getElementById("adminWelcomeSection");
  const adminApp = document.getElementById("adminApp");
  const pinInput = document.getElementById("adminPIN");
  const loginBtn = document.getElementById("loginBtn");
  const loginCancelBtn = document.getElementById("cancelBtn");
  const pinError = document.getElementById("pinError");

  // Navigation
  const navDashboard = document.getElementById("navDashboard");
  const navWorkflow = document.getElementById("navWorkflow");
  const navScan = document.getElementById("navScan");
  const navAudit = document.getElementById("navAudit");

  // Sections
  const dashboardSection = document.getElementById("adminDashboard");
  const scanPanel = document.getElementById("scanSettingsPanel");
  const auditPanel = document.getElementById("auditPanel");

  // Dashboard stats
  const statWorkflows = document.getElementById("statWorkflows");
  const statRules = document.getElementById("statRules");
  const statDepth = document.getElementById("statDepth");
  const statFiles = document.getElementById("statFiles");

  // Dashboard action buttons
  const openWorkflowFromDashboard = document.getElementById(
    "openWorkflowFromDashboard",
  );
  const openScanFromDashboard = document.getElementById(
    "openScanFromDashboard",
  );

  // Sidebar
  const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
  const sidebarLogoutBtn = document.getElementById("sidebarLogoutBtn");
  const topbarLogoutBtn = document.getElementById("topbarLogoutBtn");

  // Rule modal
  const modalOverlay = document.getElementById("ruleModalOverlay");
  const modalTitle = document.getElementById("ruleModalTitle");
  const modalWFName = document.getElementById("modalWorkflowName");
  const modalTier = document.getElementById("modalTier");
  const modalScore = document.getElementById("modalScore");
  const modalRegexToggle = document.getElementById("enableAdvancedRules");
  const modalCancelBtn = document.getElementById("ruleCancelBtn");
  const ruleSaveBtn = document.getElementById("ruleSaveBtn");
  const modalError = document.getElementById("ruleModalError");
  const ruleConditionsContainer = document.getElementById(
    "ruleConditionsContainer",
  );
  const addConditionBtn = document.getElementById("addConditionBtn");

  // Workflow manager
  const workflowCardsEl = document.getElementById("workflowCards");
  const newWorkflowNameInput = document.getElementById("newWorkflowName");
  const workflowSearchInput = document.getElementById("workflowSearchInput");
  const createWorkflowBtn = document.getElementById("createWorkflowBtn");
  const workflowError = document.getElementById("workflowError");

  // Audit
  const refreshAuditBtn = document.getElementById("refreshAuditBtn");
  const exportAuditCSVBtn = document.getElementById("exportAuditCSVBtn");

  // Super user modal
  const superUserModal = document.getElementById("superUserModal");
  const superUserPIN = document.getElementById("superUserPIN");
  const superUserLoginBtn = document.getElementById("superUserLoginBtn");
  const superUserCancelBtn = document.getElementById("superUserCancelBtn");
  const superUserError = document.getElementById("superUserError");

  // Templates
  const workflowCardTemplate = document.getElementById("workflowCardTemplate");
  const ruleRowTemplate = document.getElementById("ruleRowTemplate");
  const sopRowTemplate = document.getElementById("sopRowTemplate");
  const sopAddBoxTemplate = document.getElementById("sopAddBoxTemplate");
  const renameWorkflowTemplate = document.getElementById(
    "renameWorkflowTemplate",
  );
  const deleteWorkflowTemplate = document.getElementById(
    "deleteWorkflowTemplate",
  );
  const noSopTemplate = document.getElementById("noSopTemplate");
  const noRulesTemplate = document.getElementById("noRulesTemplate");

  // Default scan config (safe fallback for dashboard stats)
  const config = {
    scanProfile: {
      maxDepth: 25,
      maxFilesPerFolder: 50,
    },
  };

  // ----------------------------------------------------------
  // ADMIN NAME
  // ----------------------------------------------------------

  if (window.systemAPI?.getUserName) {
    try {
      currentAdminName = window.systemAPI.getUserName() || "Admin";
    } catch {
      currentAdminName = "Admin";
    }
  }

  // ----------------------------------------------------------
  // UTILITY — VISIBILITY
  // ----------------------------------------------------------

  function showElement(el) {
    if (el) el.style.display = "block";
  }

  function hideElement(el) {
    if (el) el.style.display = "none";
  }

  // ----------------------------------------------------------
  // UTILITY — UI ERRORS
  // ----------------------------------------------------------

  function showUIError(el, message) {
    el.innerHTML = `
      <div class="wf-error-box">
        <span class="wf-error-icon">⚠️</span>
        ${message}
      </div>
    `;
    el.style.display = "block";
  }

  function clearWorkflowError() {
    if (workflowError) workflowError.style.display = "none";
  }

  function showModalError(msg, timeout = AUTO_HIDE_MS) {
    if (!modalError) return;
    modalError.textContent = msg;
    modalError.style.display = "block";
    if (timeout > 0) {
      clearTimeout(modalError._hideTimer);
      modalError._hideTimer = setTimeout(() => {
        modalError.style.display = "none";
      }, timeout);
    }
  }

  function clearModalError() {
    if (modalError) modalError.style.display = "none";
  }

  // ----------------------------------------------------------
  // UTILITY — TIMESTAMP FORMATTERS
  // ----------------------------------------------------------

  function formatIST(ts) {
    if (!ts) return "";
    return (
      new Date(ts).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }) + " IST"
    );
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const date = d.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} at ${time} IST`;
  }

  function formatMultiTimezone(ts) {
    if (!ts) return "-";

    const ist = new Date(ts).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const utc = new Date(ts).toLocaleString("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const est = new Date(ts).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return `
      <div class="audit-time-main">${ist} <span class="tz">IST</span></div>
      <div class="audit-time-sub">UTC: ${utc} | EST: ${est}</div>
    `;
  }

  // ----------------------------------------------------------
  // NAVIGATION — PANEL SWITCHING
  // ----------------------------------------------------------

  function hideAllMainPanels() {
    if (adminWelcome) adminWelcome.style.display = "none";
    if (dashboardSection) dashboardSection.style.display = "none";
    if (scanPanel) scanPanel.classList.add("hidden");
    if (auditPanel) auditPanel.style.display = "none";
  }

  function setActiveNav(activeBtn) {
    [navDashboard, navWorkflow, navScan, navAudit].forEach((btn) => {
      if (btn) btn.classList.remove("active");
    });
    if (activeBtn) activeBtn.classList.add("active");
  }

  function showDashboard() {
    hideAllMainPanels();
    if (adminWelcome) adminWelcome.style.display = "block";
    setActiveNav(navDashboard);
    updateDashboardStats();
    updateDashboardScanStats();
  }

  function showWorkflows() {
    hideAllMainPanels();
    if (dashboardSection) dashboardSection.style.display = "block";
    // Clear search when switching to workflows panel so state is clean
    if (workflowSearchInput) workflowSearchInput.value = "";
    workflowSearchText = "";
    renderWorkflows();
    setActiveNav(navWorkflow);
  }

  function showScanSettings() {
    hideAllMainPanels();
    scanPanel.classList.remove("hidden");
    setActiveNav(navScan);
    loadScanSettingsIntoUI();
    document.getElementById("scanDepthInput").value =
      config.scanProfile.maxDepth ?? "";
    document.getElementById("scanFilesInput").value =
      config.scanProfile.maxFilesPerFolder ?? "";
  }

  function showAuditPanel() {
    // Optional: show active audit storage path if API is available
    const auditPathEl = document.getElementById("auditStoragePath");
    if (auditPathEl && window.auditConfigAPI?.getAuditStatus) {
      auditPathEl.textContent = "Checking…";
      window.auditConfigAPI
        .getAuditStatus()
        .then((status) => {
          auditPathEl.textContent = status.ok
            ? `${status.region} → ${status.path}`
            : "⚠ " + status.error;
        })
        .catch(() => {
          auditPathEl.textContent = "Unavailable";
        });
    }

    hideAllMainPanels();
    if (auditPanel) auditPanel.style.display = "block";
    setActiveNav(navAudit);
    refreshAuditPage();
    loadStoragePaths();
  }

  // ----------------------------------------------------------
  // NAVIGATION — EVENT BINDINGS
  // ----------------------------------------------------------

  if (navDashboard) navDashboard.onclick = showDashboard;
  if (navWorkflow) navWorkflow.onclick = showWorkflows;
  if (navScan) navScan.onclick = showScanSettings;

  if (navAudit)
    navAudit.onclick = () => {
      if (!isSuperUser) {
        openSuperUserModal();
      } else {
        showAuditPanel();
      }
      loadAuditConfigTable();
      loadStoragePaths();
      loadAuditStatsForDashboard();
    };

  if (openWorkflowFromDashboard)
    openWorkflowFromDashboard.onclick = showWorkflows;
  if (openScanFromDashboard) openScanFromDashboard.onclick = showScanSettings;

  // ----------------------------------------------------------
  // SIDEBAR
  // ----------------------------------------------------------

  if (toggleSidebarBtn && adminApp) {
    toggleSidebarBtn.onclick = () => adminApp.classList.toggle("collapsed");
  }

  if (sidebarLogoutBtn)
    sidebarLogoutBtn.onclick = () => window.location.reload();
  if (topbarLogoutBtn) topbarLogoutBtn.onclick = () => window.location.reload();

  // ----------------------------------------------------------
  // ADMIN NAME UI
  // ----------------------------------------------------------

  function updateAdminNameUI() {
    const sidebarName = document.getElementById("sidebarAdminName");
    const welcomeName = document.getElementById("welcomeAdminName");
    if (sidebarName) sidebarName.textContent = currentAdminName || "Admin";
    if (welcomeName) welcomeName.textContent = currentAdminName || "Admin";
  }

  // ----------------------------------------------------------
  // LOGIN FLOW
  // ----------------------------------------------------------

  function doLogin() {
    const pin = (pinInput?.value || "").trim();

    if (!pin) {
      if (pinError) {
        pinError.textContent = "⚠️ Please enter PIN";
        pinError.style.display = "block";
      }
      return;
    }

    if (pin !== ADMIN_PIN) {
      if (pinError) {
        pinError.textContent = "❌ Incorrect PIN";
        pinError.style.display = "block";
      }
      if (pinInput) pinInput.value = "";
      return;
    }

    if (pinError) pinError.style.display = "none";
    if (pinInput) pinInput.value = "";

    if (loginSection) loginSection.style.display = "none";
    if (adminApp) adminApp.style.display = "flex";

    loadWorkflows();
    updateDashboardScanStats();
    setTimeout(() => loadAuditStatsForDashboard(), 100);
    updateAdminNameUI();

    if (adminWelcome) adminWelcome.style.display = "block";
    if (dashboardSection) dashboardSection.style.display = "none";
    setActiveNav(navDashboard);
  }

  if (loginBtn) loginBtn.onclick = doLogin;
  if (pinInput)
    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  if (loginCancelBtn)
    loginCancelBtn.onclick = () => (window.location.href = "index.html");

  // ----------------------------------------------------------
  // SUPER USER MODAL
  // ----------------------------------------------------------

  function openSuperUserModal() {
    superUserError.style.display = "none";
    superUserPIN.value = "";
    superUserModal.classList.remove("hidden");
    superUserPIN.focus();
  }

  function closeSuperUserModal() {
    superUserModal.classList.add("hidden");
  }

  if (superUserCancelBtn) superUserCancelBtn.onclick = closeSuperUserModal;

  if (superUserLoginBtn) {
    superUserLoginBtn.onclick = () => {
      const pin = (superUserPIN.value || "").trim();

      if (!pin) {
        superUserError.textContent = "Please enter Super User PIN";
        superUserError.style.display = "block";
        return;
      }

      if (pin !== SUPER_USER_PIN) {
        superUserError.textContent = "Invalid Super User PIN";
        superUserError.style.display = "block";
        return;
      }

      isSuperUser = true;
      closeSuperUserModal();
      showAuditPanel();
    };
  }

  // ----------------------------------------------------------
  // AUDIT DETAILS MODAL
  // ----------------------------------------------------------

  function closeAuditModal() {
    document.getElementById("auditDetailsModal")?.classList.add("hidden");
  }

  document
    .getElementById("closeAuditModal")
    ?.addEventListener("click", closeAuditModal);
  document
    .getElementById("closeAuditModalFooter")
    ?.addEventListener("click", closeAuditModal);

  // Audit storage config collapse toggle
  const auditConfigHeader = document.getElementById("auditConfigHeader");
  const auditConfigBody = document.getElementById("auditConfigBody");
  const auditToggleIcon = document.getElementById("auditToggleIcon");

  if (auditConfigHeader && auditConfigBody && auditToggleIcon) {
    auditConfigHeader.onclick = () => {
      const isCollapsed = auditConfigBody.classList.contains("collapsed");
      auditConfigBody.classList.toggle("collapsed");
      auditConfigHeader.classList.toggle("active");
      auditToggleIcon.textContent = isCollapsed ? "▴" : "▾";
    };
  }

  // ----------------------------------------------------------
  // DASHBOARD STATS
  // ----------------------------------------------------------

  function updateDashboardStats() {
    if (statWorkflows) statWorkflows.textContent = workflows.length;
    if (statRules)
      statRules.textContent = workflows.reduce(
        (sum, wf) => sum + (wf.rules?.length || 0),
        0,
      );
  }

  async function updateDashboardScanStats() {
    try {
      const scanSettings = await window.scanAPI.loadScanSettings();
      if (!scanSettings) return;
      const depthEl = document.getElementById("statDepth");
      const filesEl = document.getElementById("statFiles");
      if (depthEl) depthEl.textContent = scanSettings.maxDepth;
      if (filesEl) filesEl.textContent = scanSettings.maxFilesPerFolder;
    } catch (err) {
      console.error("Failed to update dashboard scan stats", err);
    }
  }

  // ----------------------------------------------------------
  // AUDIT CHART
  // ----------------------------------------------------------

  // Chart instances — keep refs so we can destroy/rebuild on reload
  let statusDonutInstance = null;
  let fileVolumeInstance = null;
  let userRunsInstance = null;

  function renderAuditChart(runs) {
    const canvas = document.getElementById("auditChart");
    if (!canvas) return;
    if (auditChartInstance) auditChartInstance.destroy();

    // ── Aggregate by date ──
    const map = {};
    runs.forEach((r) => {
      if (!r.startedAtUTC) return;
      const key = new Date(r.startedAtUTC).toISOString().slice(0, 10);
      if (!map[key])
        map[key] = {
          total: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          files: 0,
        };
      map[key].total++;
      map[key].files += r.details?.totalFiles || 0;
      const s = (r.status || "").toUpperCase();
      if (s === "COMPLETED") map[key].completed++;
      else if (s === "FAILED") map[key].failed++;
      else if (s === "CANCELLED") map[key].cancelled++;
    });

    const labels = Object.keys(map).sort();
    const totalData = labels.map((d) => map[d].total);
    const compData = labels.map((d) => map[d].completed);
    const failData = labels.map((d) => map[d].failed);
    const cancelData = labels.map((d) => map[d].cancelled);
    const filesData = labels.map((d) => map[d].files);

    // ── Update trend badge ──
    const badge = document.getElementById("chartBadgeTrend");
    if (badge) badge.textContent = runs.length + " total runs";

    // ── Update dashboard stat cards ──
    const total = runs.length;
    const completed = runs.filter(
      (r) => (r.status || "").toUpperCase() === "COMPLETED",
    ).length;
    const failed = runs.filter(
      (r) => (r.status || "").toUpperCase() === "FAILED",
    ).length;
    const cancelled = runs.filter(
      (r) => (r.status || "").toUpperCase() === "CANCELLED",
    ).length;

    const el = (id, val) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    };
    el("statTotalRunsDash", total);
    el("statCompletedDash", completed);
    el("statFailedDash", failed);
    el("statCancelledDash", cancelled);

    // Also update audit panel stat cards if they exist
    el("statTotalRuns", total);
    el("statCompleted", completed);
    el("statFailed", failed);
    el("statCancelled", cancelled);

    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "top",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
      },
    };

    // ── Chart 1: Audit trends line ──
    auditChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Runs",
            data: totalData,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.08)",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
            fill: true,
          },
          {
            label: "Completed",
            data: compData,
            borderColor: "#22c55e",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
          },
          {
            label: "Failed",
            data: failData,
            borderColor: "#ef4444",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
          },
          {
            label: "Cancelled",
            data: cancelData,
            borderColor: "#f59e0b",
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 3,
          },
        ],
      },
      options: {
        ...chartDefaults,
        scales: {
          x: {
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: { font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: { font: { size: 11 } },
            title: { display: true, text: "Jobs", font: { size: 11 } },
          },
        },
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const date = ctx.chart.data.labels[ctx.dataIndex];
                const users = runs
                  .filter((r) => r.startedAtUTC?.slice(0, 10) === date)
                  .map((r) => r.user || "Unknown")
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .slice(0, 3);
                return [
                  `${ctx.dataset.label}: ${ctx.raw}`,
                  "Users: " + users.join(", "),
                ];
              },
            },
          },
        },
      },
    });

    // ── Chart 2: Status donut ──
    const donutCanvas = document.getElementById("statusDonutChart");
    if (donutCanvas) {
      if (statusDonutInstance) statusDonutInstance.destroy();
      statusDonutInstance = new Chart(donutCanvas, {
        type: "doughnut",
        data: {
          labels: ["Completed", "Failed", "Cancelled", "Running"],
          datasets: [
            {
              data: [
                completed,
                failed,
                cancelled,
                Math.max(0, total - completed - failed - cancelled),
              ],
              backgroundColor: ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6"],
              borderWidth: 2,
              borderColor: "#fff",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: "68%",
          plugins: {
            legend: {
              position: "bottom",
              labels: { boxWidth: 10, font: { size: 11 }, padding: 12 },
            },
            tooltip: {
              callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw}` },
            },
          },
        },
      });
    }

    // ── Chart 3: Daily file volume bar ──
    const volCanvas = document.getElementById("fileVolumeChart");
    if (volCanvas) {
      if (fileVolumeInstance) fileVolumeInstance.destroy();
      fileVolumeInstance = new Chart(volCanvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Files scanned",
              data: filesData,
              backgroundColor: "rgba(34,197,94,0.75)",
              borderColor: "#16a34a",
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: {
          ...chartDefaults,
          plugins: { ...chartDefaults.plugins, legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(0,0,0,0.04)" },
              ticks: { font: { size: 11 } },
              title: { display: true, text: "Files", font: { size: 11 } },
            },
          },
        },
      });
    }

    // ── Chart 4: Runs per user horizontal bar ──
    const userCanvas = document.getElementById("userRunsChart");
    if (userCanvas) {
      if (userRunsInstance) userRunsInstance.destroy();
      const userMap = {};
      runs.forEach((r) => {
        const u = r.user || "Unknown";
        userMap[u] = (userMap[u] || 0) + 1;
      });
      const userLabels = Object.keys(userMap)
        .sort((a, b) => userMap[b] - userMap[a])
        .slice(0, 8);
      const userVals = userLabels.map((u) => userMap[u]);

      userRunsInstance = new Chart(userCanvas, {
        type: "bar",
        data: {
          labels: userLabels,
          datasets: [
            {
              label: "Runs",
              data: userVals,
              backgroundColor: "rgba(245,158,11,0.75)",
              borderColor: "#d97706",
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: {
          ...chartDefaults,
          indexAxis: "y",
          plugins: { ...chartDefaults.plugins, legend: { display: false } },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: "rgba(0,0,0,0.04)" },
              ticks: { font: { size: 11 } },
            },
            y: { grid: { display: false }, ticks: { font: { size: 11 } } },
          },
        },
      });
    }
  }

  async function loadAuditStatsForDashboard() {
    try {
      const runs = await window.electronAPI.auditAPI.getAllRuns();
      const data = Array.isArray(runs) ? runs : [];
      renderAuditChart(data);
    } catch (err) {
      console.error("Audit stats failed", err);
    }
  }

  // ----------------------------------------------------------
  // AUDIT STORAGE CONFIG TABLE
  // ----------------------------------------------------------

  // Simple version used on navAudit click — builds rows with innerHTML.
  async function loadAuditConfigTable() {
    const res = await window.auditConfigAPI.getRegionConfig();
    if (!res.ok) {
      console.error("Failed to load config", res.error);
      return;
    }

    const tableBody = document.getElementById("auditPathTableBody");
    tableBody.innerHTML = "";

    const data = res.data;
    Object.keys(data).forEach((region) => {
      const info = data[region] || {};
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${region}</td>
        <td>${info.path || "-"}</td>
        <td>✅ Active</td>
        <td>${info.updatedAt || "-"}</td>
        <td><button onclick="editRegion('${region}')">Edit</button></td>
      `;
      tableBody.appendChild(row);
    });
  }

  // Full version used on refresh — builds rows with DOM elements and inline edit.
  async function loadAuditStorageConfig() {
    const tbody = document.getElementById("auditPathTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5">Loading region paths…</td></tr>`;

    if (!window.auditConfigAPI?.getRegionConfig) {
      tbody.innerHTML = `<tr><td colspan="5">Region config API not available</td></tr>`;
      return;
    }

    try {
      const result = await window.auditConfigAPI.getRegionConfig();
      tbody.innerHTML = "";

      if (!result.ok) {
        tbody.innerHTML = `<tr><td colspan="5">⚠ ${result.error}</td></tr>`;
        return;
      }

      const config = result.data;
      const ALL_REGIONS = [
        "AU1",
        "CA1",
        "CH1",
        "CN1",
        "DE1",
        "FR1",
        "HK1",
        "JP1",
        "UK1",
        "US1",
      ];

      ALL_REGIONS.forEach((region) => {
        const data = config[region] || {};
        const path = data?.path || "";
        const updatedAt = data?.updatedAt || null;
        let updatedBy = data?.updatedBy || "-";

        if (updatedBy === "SYSTEM_MIGRATION") updatedBy = "System";

        const formattedTime = updatedAt
          ? new Date(updatedAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }) + " IST"
          : "-";

        const status = path ? "Configured" : "Not Set";
        const tr = document.createElement("tr");

        // Region cell
        const tdRegion = document.createElement("td");
        tdRegion.innerHTML = `
          <strong>${region}</strong>
          <div class="text-muted small">${REGION_LABELS[region] || ""}</div>
        `;

        // Path cell (inline edit)
        const tdPath = document.createElement("td");
        tdPath.className = "mono";

        const span = document.createElement("span");
        span.textContent = path || "-";

        const input = document.createElement("input");
        input.value = path || "";
        input.style.display = "none";
        input.className = "form-control form-control-sm";

        tdPath.appendChild(span);
        tdPath.appendChild(input);

        // Status cell
        const tdStatus = document.createElement("td");
        tdStatus.innerHTML = `<span class="badge ${path ? "bg-success" : "bg-secondary"}">${status}</span>`;

        // Meta cell
        const tdMeta = document.createElement("td");
        tdMeta.innerHTML = `<strong>${updatedBy}</strong><br><small>${formattedTime}</small>`;

        // Actions cell
        const tdActions = document.createElement("td");
        const editBtn = document.createElement("button");
        const saveBtn = document.createElement("button");

        editBtn.textContent = "✏ Edit";
        editBtn.className = "secondary-btn";
        saveBtn.textContent = "💾 Save";
        saveBtn.className = "primary-btn";
        saveBtn.style.display = "none";

        editBtn.onclick = () => {
          span.style.display = "none";
          input.style.display = "inline-block";
          editBtn.style.display = "none";
          saveBtn.style.display = "inline-block";
          input.focus();
        };

        saveBtn.onclick = async () => {
          const newPath = input.value.trim();
          if (!newPath) {
            tdStatus.innerHTML = `<span class="text-danger">Invalid path</span>`;
            return;
          }

          saveBtn.disabled = true;
          saveBtn.textContent = "Saving...";

          const res = await window.auditConfigAPI.updateRegionPath({
            region,
            newPath,
          });

          if (!res.ok) {
            tdStatus.innerHTML = `<span class="text-danger">${res.error}</span>`;
            saveBtn.disabled = false;
            saveBtn.textContent = "💾 Save";
            return;
          }

          span.textContent = newPath;
          span.style.display = "inline";
          input.style.display = "none";
          editBtn.style.display = "inline-block";
          saveBtn.style.display = "none";
          tdStatus.innerHTML = `<span class="badge bg-success">Configured</span>`;

          loadAuditStorageConfig();
        };

        tdActions.appendChild(editBtn);
        tdActions.appendChild(saveBtn);

        tr.appendChild(tdRegion);
        tr.appendChild(tdPath);
        tr.appendChild(tdStatus);
        tr.appendChild(tdMeta);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="5">Failed to load region config</td></tr>`;
    }
  }

  async function loadStoragePaths() {
    const res = await window.auditConfigAPI.getStoragePaths();
    if (!res.ok) return;
    document.getElementById("configPath").textContent = res.data.configPath;
    document.getElementById("localAuditPath").textContent =
      res.data.localAuditPath;
    document.getElementById("regionAuditPath").textContent =
      res.data.regionAuditPath || "Not configured";
  }

  // ----------------------------------------------------------
  // AUDIT TABLE
  // ----------------------------------------------------------

  async function loadAuditTable() {
    const tbody = document.getElementById("auditTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:#9ca3af;font-size:13px">Loading audit records…</td></tr>`;

    const runs = await window.electronAPI.auditAPI.getAllRuns();
    ALL_AUDIT_RUNS = Array.isArray(runs) ? runs : runs?.runs || [];
    renderAuditTable(ALL_AUDIT_RUNS);
  }

  function renderAuditTable(runs) {
    const tbody = document.getElementById("auditTableBody");
    tbody.innerHTML = "";

    // Update summary stat cards
    const total = runs.length;
    const completed = runs.filter(
      (r) => (r.status || "").toLowerCase() === "completed",
    ).length;
    const failed = runs.filter(
      (r) => (r.status || "").toLowerCase() === "failed",
    ).length;
    const cancelled = runs.filter(
      (r) => (r.status || "").toLowerCase() === "cancelled",
    ).length;

    const statTotal = document.getElementById("statTotalRuns");
    const statCompleted = document.getElementById("statCompleted");
    const statFailed = document.getElementById("statFailed");
    const statCancelled = document.getElementById("statCancelled");

    if (statTotal) statTotal.textContent = total;
    if (statCompleted) statCompleted.textContent = completed;
    if (statFailed) statFailed.textContent = failed;
    if (statCancelled) statCancelled.textContent = cancelled;

    // Update pagination info
    const paginationInfo = document.getElementById("auditPaginationInfo");
    if (paginationInfo) {
      paginationInfo.textContent = total
        ? `Showing ${total} run${total !== 1 ? "s" : ""}`
        : "";
    }

    if (!runs.length) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:#9ca3af;font-size:13px">No matching audit records</td></tr>`;
      return;
    }

    runs.forEach((run) => {
      const detectedPills =
        (run.detectedWorkflows || [])
          .map(
            (w) =>
              `<span class="audit-wf-pill">${(w || "").toUpperCase()}</span>`,
          )
          .join("") || "<span style='color:#9ca3af;font-size:12px'>—</span>";

      const usedPills =
        (run.usedWorkflows || [])
          .map(
            (w) =>
              `<span class="audit-wf-pill used">${(w || "").toUpperCase()}</span>`,
          )
          .join("") || "<span style='color:#9ca3af;font-size:12px'>—</span>";

      const paths =
        (run.analysisPaths || []).join("<br>") ||
        "<span style='color:#9ca3af'>—</span>";
      const status = (run.status || "unknown").toLowerCase();

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="audit-runtime">${formatMultiTimezone(run.startedAtUTC)}</td>
        <td style="font-weight:600">${run.user || "—"}</td>
        <td class="mono">${run.machine || "Unknown"}</td>
        <td style="font-weight:600">${run.alphaCode || "—"}</td>
        <td style="font-weight:600">${run.taskNumber || "—"}</td>
        <td style="text-align:right;font-weight:600">${run.details?.totalFiles ?? "—"}</td>
        <td style="font-weight:600">${run.details?.totalSizeGB ?? "0"} GB</td>
        <td><span class="audit-status ${status}">${run.status}</span></td>
        <td>${detectedPills}</td>
        <td>${usedPills}</td>
        <td style="font-size:12px;color:#374151">${paths}</td>
        <td style="text-align:center">
          <button class="audit-row-btn audit-view-btn" title="View details">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/>
              <path d="M10 9v4M10 7v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </td>
      `;
      tr.querySelector(".audit-view-btn").onclick = () => viewAuditDetails(run);
      tbody.appendChild(tr);
    });
  }

  function viewAuditDetails(run) {
    const modal = document.getElementById("auditDetailsModal");
    const body = document.getElementById("auditDetailsBody");

    body.innerHTML = `
      <div class="audit-detail-row">
        <span class="audit-detail-label">Machine</span>
        <span class="audit-detail-value">${run.machine || "Unknown"}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Alpha</span>
        <span class="audit-detail-value">${run.alphaCode || "-"}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Task</span>
        <span class="audit-detail-value">${run.taskNumber || "-"}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Status</span>
        <span class="audit-detail-value">${run.status}</span>
      </div>
      <hr>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Started</span>
        <span class="audit-detail-value">${formatMultiTimezone(run.startedAtUTC)}</span>
      </div>
      <hr>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Limited Scan</span>
        <span class="audit-detail-value">${run.details?.limited || "-"}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Full Scan</span>
        <span class="audit-detail-value">${run.details?.full || "-"}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Files</span>
        <span class="audit-detail-value">${run.details?.totalFiles ?? 0}</span>
      </div>
      <div class="audit-detail-row">
        <span class="audit-detail-label">Size</span>
        <span class="audit-detail-value">${run.details?.totalSizeGB || "0"} GB</span>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  // Audit table filters
  ["filterUser", "filterMachine", "filterAlpha", "filterTask"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", applyAuditFilters);
  });

  function applyAuditFilters() {
    const user = document.getElementById("filterUser").value.toLowerCase();
    const mach = document.getElementById("filterMachine").value.toLowerCase();
    const a = document.getElementById("filterAlpha").value.toLowerCase();
    const t = document.getElementById("filterTask").value.toLowerCase();

    const filtered = ALL_AUDIT_RUNS.filter(
      (r) =>
        (!user || ((r.user || "") + "").toLowerCase().includes(user)) &&
        (!mach || ((r.machine || "") + "").toLowerCase().includes(mach)) &&
        (!a || ((r.alphaCode || "") + "").toLowerCase().includes(a)) &&
        (!t || ((r.taskNumber || "") + "").toLowerCase().includes(t)),
    );

    renderAuditTable(filtered);
  }

  // ----------------------------------------------------------
  // AUDIT REFRESH
  // ----------------------------------------------------------

  async function refreshAuditPage() {
    const loader = document.getElementById("auditLoader");
    const auditBody = document.getElementById("auditTableBody");

    if (refreshAuditBtn) refreshAuditBtn.disabled = true;
    if (auditBody)
      auditBody.innerHTML = `<tr><td colspan="12">Loading audit logs…</td></tr>`;

    if (auditPanel) auditPanel.classList.add("loading");
    if (loader) loader.style.display = "block";

    await new Promise(requestAnimationFrame);

    try {
      await Promise.all([loadAuditStorageConfig(), loadAuditTable()]);
    } catch (err) {
      console.error("Audit refresh failed:", err);
    } finally {
      if (auditPanel) auditPanel.classList.remove("loading");
      if (loader) loader.style.display = "none";
      if (refreshAuditBtn) refreshAuditBtn.disabled = false;
    }
  }

  if (refreshAuditBtn) refreshAuditBtn.onclick = refreshAuditPage;

  if (exportAuditCSVBtn) {
    exportAuditCSVBtn.onclick = async () => {
      exportAuditCSVBtn.disabled = true;
      try {
        const res = await window.auditExportAPI.exportCSV();
        if (res?.ok && res.filePath) {
          alert(`Audit CSV exported:\n${res.filePath}`);
        } else if (!res?.canceled) {
          alert(res?.error || "CSV export failed");
        }
      } catch (err) {
        console.error(err);
        alert("Unexpected error during CSV export");
      } finally {
        exportAuditCSVBtn.disabled = false;
      }
    };
  }

  // ----------------------------------------------------------
  // SCAN SETTINGS
  // ----------------------------------------------------------

  function showScanMessage(type, text) {
    const box = document.getElementById("scanSettingsMessage");
    if (!box) return;
    box.className = `scan-message ${type}`;
    box.textContent = text;
    box.style.display = "block";
    clearTimeout(box._timer);
    box._timer = setTimeout(() => {
      box.style.display = "none";
    }, 5000);
  }

  function showScanStatus({ type, message, updatedAt, updatedBy }) {
    const card = document.getElementById("scanStatusCard");
    const msg = document.getElementById("scanStatusMessage");
    const time = document.getElementById("scanUpdatedAt");
    const user = document.getElementById("scanUpdatedBy");

    card.classList.remove("success", "error", "hidden");
    card.classList.add(type);

    msg.textContent = message;
    time.textContent = updatedAt ? `Last updated: ${formatIST(updatedAt)}` : "";
    user.textContent = updatedBy ? `Updated by: ${updatedBy}` : "";
  }

  async function loadScanSettingsIntoUI() {
    try {
      const data = await window.scanAPI.loadScanSettings();
      if (!data) return;
      document.getElementById("scanDepthInput").value = data.maxDepth;
      document.getElementById("scanFilesInput").value = data.maxFilesPerFolder;
      showScanStatus({
        type: "success",
        message: "Current scan settings loaded.",
        updatedAt: data.lastUpdatedAt,
        updatedBy: data.updatedBy,
      });
    } catch {
      showScanStatus({
        type: "error",
        message: "Failed to load scan settings.",
      });
    }
  }

  const saveScanSettingsBtn = document.getElementById("saveScanSettings");
  if (saveScanSettingsBtn)
    saveScanSettingsBtn.onclick = async () => {
      const maxDepth = Number(document.getElementById("scanDepthInput").value);
      const maxFiles = Number(document.getElementById("scanFilesInput").value);

      if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 25) {
        showScanStatus({
          type: "error",
          message: "Max Folder Depth must be between 1 and 25.",
        });
        return;
      }

      if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 500) {
        showScanStatus({
          type: "error",
          message: "Max Files per Folder must be between 1 and 500.",
        });
        return;
      }

      const scanSettings = {
        maxDepth,
        maxFilesPerFolder: maxFiles,
        lastUpdatedAt: Date.now(),
        updatedBy: currentAdminName,
      };

      try {
        await window.scanAPI.saveScanSettings(scanSettings);
        showScanStatus({
          type: "success",
          message: "Scan settings saved successfully.",
          updatedAt: scanSettings.lastUpdatedAt,
          updatedBy: scanSettings.updatedBy,
        });
        updateDashboardScanStats();
      } catch (err) {
        console.error(err);
        showScanStatus({
          type: "error",
          message: "Failed to save scan settings.",
        });
      }
    };

  // ----------------------------------------------------------
  // WORKFLOW LOAD / SAVE
  // ----------------------------------------------------------

  function loadWorkflows() {
    if (!window.electronAPI?.loadWorkflows) {
      workflows = [];
      renderWorkflows();
      return;
    }

    // Note: normalisation below runs on the stale pre-load array
    // and is immediately overwritten — kept for behavioural parity.
    // workflows.forEach((w) => {
    //if (typeof w.overlayRequired !== "boolean") w.overlayRequired = false;
    // });

    window.electronAPI
      .loadWorkflows()
      .then((res) => {
        workflows =
          res?.ok && Array.isArray(res.workflows) ? res.workflows : [];

        workflows.forEach((w) => {
          if (!Array.isArray(w.sop)) w.sop = [];
          if (!Array.isArray(w.rules)) w.rules = [];
          if (!w.lastUpdatedAt) w.lastUpdatedAt = Date.now();
          if (!w.updatedBy) w.updatedBy = currentAdminName;
        });

        renderWorkflows();
        updateDashboardStats();
      })
      .catch(() => {
        workflows = [];
        renderWorkflows();
        updateDashboardStats();
      });
  }

  function saveWorkflows() {
    if (!window.electronAPI?.saveWorkflows) return Promise.resolve();
    return window.electronAPI.saveWorkflows({ workflows });
  }

  // ----------------------------------------------------------
  // WORKFLOW SEARCH
  // ----------------------------------------------------------

  if (workflowSearchInput) {
    workflowSearchInput.addEventListener("input", () => {
      workflowSearchText = workflowSearchInput.value.toLowerCase().trim();
      renderWorkflows();
    });
  }

  // ----------------------------------------------------------
  // CREATE WORKFLOW
  // ----------------------------------------------------------

  if (newWorkflowNameInput && workflowError) {
    newWorkflowNameInput.addEventListener("input", () => {
      workflowError.style.display = "none";
    });
  }

  if (createWorkflowBtn && newWorkflowNameInput) {
    createWorkflowBtn.onclick = () => {
      const name = (newWorkflowNameInput.value || "").trim();

      if (!name) {
        showUIError(workflowError, "Workflow name cannot be empty.");
        newWorkflowNameInput.focus();
        return;
      }

      if (
        workflows.some((w) => w.workflow.toLowerCase() === name.toLowerCase())
      ) {
        showUIError(workflowError, "❌ Workflow already exists.");
        newWorkflowNameInput.focus();
        return;
      }

      workflows.unshift({
        workflow: name,
        sop: [],
        rules: [],
        lastUpdatedAt: Date.now(),
        updatedBy: currentAdminName,
      });

      newWorkflowNameInput.value = "";
      workflowError.style.display = "none";

      saveWorkflows().then(() => {
        renderWorkflows();
        updateDashboardStats();
      });
    };
  }

  // ----------------------------------------------------------
  // RENDER WORKFLOWS
  // ----------------------------------------------------------

  function renderWorkflows() {
    if (!workflowCardsEl) return;
    workflowCardsEl.innerHTML = "";

    const filtered = workflows
      .map((wf, originalIndex) => ({ wf, originalIndex }))
      .filter(
        ({ wf }) =>
          !workflowSearchText ||
          wf.workflow.toLowerCase().includes(workflowSearchText),
      );

    filtered.forEach(({ wf, originalIndex: wfIndex }) => {
      if (!workflowCardTemplate) return;
      const frag = workflowCardTemplate.content.cloneNode(true);
      const card = frag.querySelector(".workflow-card");
      if (!card) return;
      card.dataset.wf = wfIndex;

      // Workflow name
      const nameEl = card.querySelector(".wf-name");
      if (nameEl) nameEl.textContent = wf.workflow;

      // Rule count — support both old badge text and new inner span
      const countTextEl = card.querySelector(".wf-rule-count-text");
      const countEl = card.querySelector(".wf-rule-count");
      const ruleCount = (wf.rules || []).length;
      if (countTextEl) countTextEl.textContent = `${ruleCount} / 5 rules`;
      else if (countEl) countEl.textContent = `Rules: ${ruleCount}/5`;

      // Overlay required toggle
      const overlayToggle = card.querySelector(".wf-overlay-required");
      if (overlayToggle) {
        overlayToggle.checked = !!wf.overlayRequired;
        overlayToggle.onchange = () => {
          wf.overlayRequired = overlayToggle.checked;
          wf.lastUpdatedAt = Date.now();
          wf.updatedBy = currentAdminName;
          saveWorkflows().then(renderWorkflows);
        };
      }

      // Last updated meta
      const updatedEl = card.querySelector(".wf-updated");
      if (updatedEl) {
        updatedEl.innerHTML = `
            <div class="wf-meta">
              <div class="wf-meta-time">⏱ Last updated: ${formatMultiTimezone(wf.lastUpdatedAt)}</div>
              <div class="wf-meta-user">Updated by <strong>${wf.updatedBy}</strong></div>
            </div>
          `;
      }

      // SOP list
      const sopList = card.querySelector(".wf-sop-list");
      const sopError = card.querySelector(".wf-sop-error");
      sopList.innerHTML = "";

      if (Array.isArray(wf.sop) && wf.sop.length) {
        wf.sop.forEach((link, i) => {
          const sFrag = sopRowTemplate.content.cloneNode(true);
          const sRow = sFrag.querySelector(".sop-row");
          const a = sRow.querySelector(".wf-sop-link");
          const btn = sRow.querySelector(".sop-remove-btn");

          if (a) {
            a.href = link;
            a.textContent = link;
          }
          if (btn) {
            btn.dataset.i = i;
            btn.dataset.w = wfIndex;
            btn.onclick = () => {
              const si = Number(btn.dataset.i);
              if (!Number.isFinite(si)) return;
              wf.sop.splice(si, 1);
              wf.lastUpdatedAt = Date.now();
              wf.updatedBy = currentAdminName;
              saveWorkflows().then(renderWorkflows);
            };
          }
          sopList.appendChild(sFrag);
        });
      } else {
        if (noSopTemplate)
          sopList.appendChild(noSopTemplate.content.cloneNode(true));
      }

      // SOP add inline box
      const sopBox = card.querySelector(".wf-sop-add-box");
      sopBox.innerHTML = "";

      if (sopAddBoxTemplate) {
        sopBox.appendChild(sopAddBoxTemplate.content.cloneNode(true));
        const sopInput = sopBox.querySelector(".wf-sop-input");
        const sopSaveBtn = sopBox.querySelector(".wf-sop-save");
        const sopCancelBtn = sopBox.querySelector(".wf-sop-cancel");

        if (sopInput && sopError) {
          sopInput.addEventListener("input", () => {
            sopError.innerHTML = "";
            sopError.style.display = "none";
          });
        }

        if (sopCancelBtn) {
          sopCancelBtn.onclick = () => {
            sopBox.style.display = "none";
            if (sopError) {
              sopError.innerHTML = "";
              sopError.style.display = "none";
            }
            if (sopInput) sopInput.value = "";
          };
        }

        if (sopSaveBtn) {
          sopSaveBtn.onclick = () => {
            const link = (sopInput?.value || "").trim();
            if (!link) {
              if (sopError) showUIError(sopError, "SOP link cannot be empty.");
              return;
            }
            if (!Array.isArray(wf.sop)) wf.sop = [];
            if (wf.sop.length >= 5) {
              if (sopError) showUIError(sopError, "Maximum 5 SOPs allowed.");
              return;
            }
            wf.sop.push(link);
            wf.lastUpdatedAt = Date.now();
            wf.updatedBy = currentAdminName;
            sopBox.style.display = "none";
            saveWorkflows().then(renderWorkflows);
          };
        }
      }

      const addSopBtn = card.querySelector(".wf-add-sop");
      if (addSopBtn && sopBox) {
        addSopBtn.onclick = () => {
          sopBox.style.display = "flex";
          const input = sopBox.querySelector(".wf-sop-input");
          if (input) {
            input.value = "";
            input.focus();
          }
        };
      }

      // Rules list
      const ruleListContainer = card.querySelector(".wf-rule-list");
      ruleListContainer.innerHTML = "";
      const rules = Array.isArray(wf.rules) ? wf.rules : [];

      if (!rules.length) {
        if (noRulesTemplate)
          ruleListContainer.appendChild(
            noRulesTemplate.content.cloneNode(true),
          );
      } else {
        rules.forEach((r, ri) => {
          const rfrag = ruleRowTemplate.content.cloneNode(true);
          const row = rfrag.querySelector(".wf-rule-row");
          row.dataset.wf = wfIndex;
          row.dataset.r = ri;

          const txt = row.querySelector(".wf-rule-text");
          const metaText = row.querySelector(".wf-rule-meta-text");
          const tierPill = row.querySelector(".wf-rule-tier");

          if (Array.isArray(r.conditions)) {
            txt.textContent = r.conditions
              .map(
                (c, i) =>
                  `${i === 0 ? "" : `${c.logic} `}${c.pattern} (${c.type})`,
              )
              .join(" ");
          } else {
            txt.textContent = r.pattern || "";
          }

          if (metaText) metaText.textContent = `score ${r.score}`;

          if (tierPill) {
            tierPill.textContent = r.tier || "";
            tierPill.classList.remove("primary", "secondary", "tertiary");
            if (r.tier) tierPill.classList.add(r.tier);
          }

          const editBtn = row.querySelector(".wf-edit");
          const deleteBtn = row.querySelector(".wf-delete-rule");
          const confirmBox = row.querySelector(".wf-rule-confirm");
          const cancelDel = row.querySelector(".wf-cancel-del");
          const confirmDel = row.querySelector(".wf-confirm-del");

          if (editBtn) editBtn.onclick = () => openRuleModal(wfIndex, ri);
          if (deleteBtn && confirmBox)
            deleteBtn.onclick = () => {
              confirmBox.style.display = "flex";
            };
          if (cancelDel && confirmBox)
            cancelDel.onclick = () => {
              confirmBox.style.display = "none";
            };
          if (confirmDel) {
            confirmDel.onclick = () => {
              wf.rules.splice(ri, 1);
              wf.lastUpdatedAt = Date.now();
              wf.updatedBy = currentAdminName;
              saveWorkflows().then(renderWorkflows);
            };
          }

          ruleListContainer.appendChild(rfrag);
        });
      }

      // Add rule button
      const addRuleBtn = card.querySelector(".wf-add-rule");
      if (addRuleBtn) addRuleBtn.onclick = () => openRuleModal(wfIndex, null);

      // Rename inline bar
      const renameBox = card.querySelector(".wf-rename-box");
      renameBox.innerHTML = "";

      if (renameWorkflowTemplate) {
        renameBox.appendChild(renameWorkflowTemplate.content.cloneNode(true));
        const renameCancel = renameBox.querySelector(".wf-rename-cancel");
        const renameSave = renameBox.querySelector(".wf-rename-save");
        const renameInp = renameBox.querySelector(".wf-rename-input");
        const renameError = renameBox.querySelector(".wf-rename-error");

        if (renameCancel) {
          renameCancel.onclick = () => {
            if (renameError) renameError.style.display = "none";
            renameBox.style.display = "none";
          };
        }

        if (renameSave) {
          renameSave.onclick = () => {
            const newName = (renameInp?.value || "").trim();
            if (renameError) renameError.style.display = "none";

            if (!newName) {
              showUIError(renameError, "Workflow name cannot be empty.");
              return;
            }
            if (
              workflows.some(
                (w, idx) =>
                  idx !== wfIndex &&
                  w.workflow.toLowerCase() === newName.toLowerCase(),
              )
            ) {
              showUIError(
                renameError,
                "Workflow already exists with the same name.",
              );
              return;
            }

            wf.workflow = newName;
            wf.lastUpdatedAt = Date.now();
            wf.updatedBy = currentAdminName;
            renameBox.style.display = "none";
            saveWorkflows().then(renderWorkflows);
          };
        }
      }

      const renameBtn = card.querySelector(".wf-rename");
      if (renameBtn && renameBox) {
        renameBtn.onclick = () => {
          renameBox.style.display = "flex";
          const inp = renameBox.querySelector(".wf-rename-input");
          const renameError = renameBox.querySelector(".wf-rename-error");
          if (renameError) renameError.style.display = "none";
          if (inp) {
            inp.value = wf.workflow;
            inp.focus();
          }
        };
      }

      // Delete confirm bar
      const delBox = card.querySelector(".wf-delete-confirm");
      delBox.innerHTML = "";

      if (deleteWorkflowTemplate) {
        delBox.appendChild(deleteWorkflowTemplate.content.cloneNode(true));
        const delCancel = delBox.querySelector(".wf-del-cancel");
        const delYes = delBox.querySelector(".wf-del-yes");
        if (delCancel)
          delCancel.onclick = () => {
            delBox.style.display = "none";
          };
        if (delYes)
          delYes.onclick = () => {
            workflows.splice(wfIndex, 1);
            saveWorkflows().then(renderWorkflows);
          };
      }

      // Wire ALL .wf-delete buttons (header ✕ + footer Delete) to the confirm box
      card.querySelectorAll(".wf-delete").forEach((delBtn) => {
        delBtn.onclick = () => {
          if (delBox) delBox.style.display = "flex";
        };
      });

      workflowCardsEl.appendChild(frag);
    });
  }

  // ----------------------------------------------------------
  // RULE MODAL — CONDITIONS
  // ----------------------------------------------------------

  function createConditionRow({
    logic = "AND",
    pattern = "",
    type = "keyword",
  } = {}) {
    const row = document.createElement("div");
    row.className = "rule-condition-row";
    row.innerHTML = `
      <select class="logic-operator">
        <option value="AND">and</option>
        <option value="OR">or</option>
        <option value="AND_NOT">and not</option>
      </select>
      <input type="text" class="condition-pattern" placeholder="Enter value">
      <select class="condition-type"></select>
      <button type="button" class="remove-condition">✕</button>
    `;

    row.querySelector(".logic-operator").value = logic;
    row.querySelector(".condition-pattern").value = pattern;

    const typeSelect = row.querySelector(".condition-type");
    typeSelect.innerHTML = "";
    typeSelect.add(new Option("keyword", "keyword"));
    typeSelect.add(new Option("extension", "extension"));

    if (modalRegexToggle.checked) {
      typeSelect.add(new Option("regex", "regex"));
    }

    // Fall back to keyword if regex is disabled but type was regex
    typeSelect.value =
      !modalRegexToggle.checked && type === "regex" ? "keyword" : type;

    return row;
  }

  function updateLogicVisibility() {
    const rows = ruleConditionsContainer.querySelectorAll(
      ".rule-condition-row",
    );
    rows.forEach((row, index) => {
      const logic = row.querySelector(".logic-operator");
      if (logic) logic.style.visibility = index === 0 ? "hidden" : "visible";
    });
  }

  function updateRemoveButtons() {
    const rows = ruleConditionsContainer.querySelectorAll(
      ".rule-condition-row",
    );
    rows.forEach((r) => {
      r.querySelector(".remove-condition").style.display =
        rows.length > 1 ? "inline" : "none";
    });
  }

  // Condition container — remove row on ✕ click
  if (ruleConditionsContainer) {
    ruleConditionsContainer.addEventListener("click", (e) => {
      if (!e.target.closest(".remove-condition")) return;
      const row = e.target.closest(".rule-condition-row");
      if (!row) return;
      row.remove();
      updateLogicVisibility();
      updateRemoveButtons();
    });
  }

  // Condition container — clear error on pattern input
  if (ruleConditionsContainer) {
    ruleConditionsContainer.addEventListener("input", (e) => {
      if (e.target.classList.contains("condition-pattern")) {
        e.target.classList.remove("input-error");
        clearModalError();
      }
    });
  }

  if (addConditionBtn && ruleConditionsContainer) {
    addConditionBtn.onclick = () => {
      ruleConditionsContainer.appendChild(createConditionRow());
      updateLogicVisibility();
      updateRemoveButtons();
    };
  }

  // Global regex toggle — adds/removes "regex" option from all condition dropdowns
  if (modalRegexToggle) {
    modalRegexToggle.onchange = () => {
      ruleConditionsContainer
        .querySelectorAll(".rule-condition-row")
        .forEach((row) => {
          const typeSelect = row.querySelector(".condition-type");
          if (!typeSelect) return;
          const regexOption = typeSelect.querySelector('option[value="regex"]');

          if (modalRegexToggle.checked) {
            if (!regexOption) typeSelect.add(new Option("regex", "regex"));
          } else {
            if (regexOption) {
              if (typeSelect.value === "regex") typeSelect.value = "keyword";
              regexOption.remove();
            }
          }
        });
    };
  }

  // ----------------------------------------------------------
  // RULE MODAL — OPEN / CLOSE
  // ----------------------------------------------------------

  function openRuleModal(wi, ri = null) {
    currentWF = Number(wi);
    currentRule = ri === null ? null : Number(ri);

    const wf = workflows[currentWF];
    if (!wf) return;

    // Require at least one SOP before allowing rule creation
    if (!Array.isArray(wf.sop) || wf.sop.length === 0) {
      const card = document.querySelector(
        `.workflow-card[data-wf="${currentWF}"]`,
      );
      const sopErr = card?.querySelector(".wf-sop-error");
      if (sopErr)
        showUIError(sopErr, "Add at least 1 SOP before creating rules.");
      return;
    }

    modalWFName.value = wf.workflow || "";
    clearModalError();
    ruleConditionsContainer.innerHTML = "";

    if (currentRule === null) {
      // Add mode
      modalTitle.textContent = "Add Rule";
      modalRegexToggle.checked = false;
      modalTier.value = "secondary";
      modalScore.value = 50;
      ruleConditionsContainer.appendChild(createConditionRow());
    } else {
      // Edit mode
      const r = wf.rules[currentRule];
      modalTitle.textContent = "Edit Rule";
      modalRegexToggle.checked = r.regexEnabled === true;
      modalRegexToggle.dispatchEvent(new Event("change"));

      if (Array.isArray(r.conditions)) {
        r.conditions.forEach((c) => {
          ruleConditionsContainer.appendChild(
            createConditionRow({
              logic: c.logic,
              pattern: c.pattern,
              type: c.type,
            }),
          );
        });
      }

      // Re-dispatch to apply checkbox state to newly added rows
      modalRegexToggle.dispatchEvent(new Event("change"));

      modalTier.value = r.tier || "secondary";
      modalScore.value = r.score || 50;
    }

    updateLogicVisibility();
    updateRemoveButtons();
    modalOverlay.style.display = "flex";
  }

  function closeRuleModal() {
    modalOverlay.style.display = "none";
    currentWF = null;
    currentRule = null;
    clearModalError();
  }

  if (modalCancelBtn) modalCancelBtn.onclick = closeRuleModal;

  // ----------------------------------------------------------
  // RULE MODAL — SAVE
  // ----------------------------------------------------------

  if (ruleSaveBtn)
    ruleSaveBtn.onclick = () => {
      if (currentWF === null) return;

      const wf = workflows[currentWF];
      const rows = ruleConditionsContainer.querySelectorAll(
        ".rule-condition-row",
      );

      if (!rows.length) {
        showModalError("Add at least one condition.");
        return;
      }

      const conditions = [];
      let hasEmpty = false;
      let firstInvalidInput = null;

      rows.forEach((row) => {
        const logic = row.querySelector(".logic-operator").value;
        const input = row.querySelector(".condition-pattern");
        const pattern = input.value.trim();
        const type = row.querySelector(".condition-type").value;

        if (!pattern) {
          hasEmpty = true;
          input.classList.add("input-error");
          if (!firstInvalidInput) firstInvalidInput = input;
          return;
        }

        conditions.push({ logic, pattern, type });
      });

      if (hasEmpty) {
        showModalError("All condition patterns must be filled.");
        if (firstInvalidInput) {
          firstInvalidInput.focus({ preventScroll: false });
          firstInvalidInput.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
        return;
      }

      const ruleObj = {
        conditions,
        tier: modalTier.value,
        score: Number(modalScore.value) || 50,
        regexEnabled: modalRegexToggle.checked === true,
      };

      if (!Array.isArray(wf.rules)) wf.rules = [];

      if (currentRule === null) {
        if (wf.rules.length >= 5) {
          showModalError("Max 5 rules allowed.");
          return;
        }
        wf.rules.push(ruleObj);
      } else {
        wf.rules[currentRule] = ruleObj;
      }

      wf.lastUpdatedAt = Date.now();
      wf.updatedBy = currentAdminName;

      saveWorkflows().then(() => {
        closeRuleModal();
        renderWorkflows();
        updateDashboardStats();
      });
    };

  // Score input — clamp to 1–100 integers
  if (modalScore) {
    modalScore.addEventListener("input", () => {
      modalScore.value = (modalScore.value || "")
        .toString()
        .replace(/\D/g, "")
        .slice(0, 3);
    });
    modalScore.addEventListener("blur", () => {
      let v = parseInt(modalScore.value, 10);
      if (!v || isNaN(v)) v = 1;
      if (v < 1) v = 1;
      if (v > 100) v = 100;
      modalScore.value = String(v);
    });
  }

  // ESC closes rule modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRuleModal();
  });

  // ----------------------------------------------------------
  // INFO TOOLTIPS
  // ----------------------------------------------------------

  function initInfoTooltips() {
    const tooltip = document.getElementById("infoTooltip");
    if (!tooltip) return;

    document.addEventListener("mouseover", (e) => {
      const bubble = e.target.closest(".info-bubble");
      if (!bubble) return;
      const text = bubble.getAttribute("data-info");
      if (!text) return;
      tooltip.innerHTML = text;
      tooltip.style.display = "block";
      tooltip.style.opacity = "1";
    });

    document.addEventListener("mousemove", (e) => {
      if (tooltip.style.display === "block") {
        tooltip.style.left = e.clientX + 10 + "px";
        tooltip.style.top = e.clientY + 10 + "px";
      }
    });

    document.addEventListener("mouseout", (e) => {
      if (!e.target.closest(".info-bubble")) return;
      tooltip.style.opacity = "0";
      setTimeout(() => {
        tooltip.style.display = "none";
      }, 120);
    });
  }

  // ----------------------------------------------------------
  // INITIAL STATE
  // ----------------------------------------------------------

  if (loginSection) loginSection.style.display = "block";
  if (adminWelcome) adminWelcome.style.display = "none";
  if (dashboardSection) dashboardSection.style.display = "none";
  if (pinError) pinError.style.display = "none";

  initInfoTooltips();
  loadWorkflows();
});
