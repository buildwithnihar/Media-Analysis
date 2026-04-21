// workflow.js — Workflow dropdown, SOP rendering, and detected workflow display

(() => {
  "use strict";

  // ----------------------------------------------------------
  // MODULE STATE
  // ----------------------------------------------------------

  let WORKFLOW_DATA = []; // loaded from backend via electronAPI
  let workflowSelect = null; // cached native <select> element

  // ----------------------------------------------------------
  // DOM HELPERS
  // ----------------------------------------------------------

  const $id = (id) => document.getElementById(id);

  const templates = {
    detectedBox: () => $id("workflowDetectedTemplate").content.cloneNode(true),
    sopCard: () => $id("sopCardTemplate").content.cloneNode(true),
    sopLink: () => $id("sopLinkTemplate").content.cloneNode(true),
  };

  // ----------------------------------------------------------
  // HTML ESCAPE UTILITY
  // ----------------------------------------------------------

  function escapeHtml(text) {
    return String(text ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // ----------------------------------------------------------
  // WORKFLOW DATA LOADER
  // ----------------------------------------------------------

  async function loadAdminWorkflowJSON() {
    try {
      const res = await window.electronAPI.loadWorkflows();
      WORKFLOW_DATA = Array.isArray(res?.workflows) ? res.workflows : [];
      loadWorkflowOptions();
    } catch (err) {
      console.error("Failed to load workflows:", err);
      WORKFLOW_DATA = [];
    }
  }

  // ----------------------------------------------------------
  // WORKFLOW DROPDOWN (TomSelect)
  // ----------------------------------------------------------

  function loadWorkflowOptions() {
    workflowSelect = $id("workflowUsed");
    if (!workflowSelect) return;

    // Destroy any existing TomSelect instance before rebuilding.
    if (workflowSelect.tomselect) {
      workflowSelect.tomselect.destroy();
      workflowSelect.tomselect = null;
    }

    workflowSelect.innerHTML = "";

    WORKFLOW_DATA.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.workflow;
      opt.textContent = w.workflow;
      workflowSelect.appendChild(opt);
    });

    const ts = new TomSelect(workflowSelect, {
      plugins: ["remove_button"],
      maxItems: null,
      create: false,
      placeholder: "Select workflow(s) manually or confirm detected ones",
    });

    window.WORKFLOW_UI_READY = true;

    // onChangeDisabled is a custom flag used to suppress the change
    // event while applyDetectedWorkflows() programmatically adds items,
    // preventing duplicate backend calls and SOP renders.
    ts.onChangeDisabled = false;

    // Flush any workflows that were detected before the UI was ready.
    if (window.PENDING_DETECTED_WORKFLOWS) {
      window.applyDetectedWorkflows({
        workflows: window.PENDING_DETECTED_WORKFLOWS,
      });
      delete window.PENDING_DETECTED_WORKFLOWS;
    }

    ts.on("change", async () => {
      if (ts.onChangeDisabled) return;

      const raw = ts.getValue();
      const workflows = Array.isArray(raw) ? raw : raw ? [raw] : [];

      if (window.electronAPI?.updateUsedWorkflows) {
        await window.electronAPI.updateUsedWorkflows(workflows);
      }

      updateSOPview(raw);

      if (window.validateWorkflowUsed) window.validateWorkflowUsed();
    });
  }

  // ----------------------------------------------------------
  // RESET WORKFLOW UI
  // ----------------------------------------------------------

  function resetWorkflowDetection() {
    $id("workflowResult").innerHTML = "";
    $id("sopLinksContainer").innerHTML = "";

    const ts = workflowSelect?.tomselect;
    if (ts) {
      ts.clear();
      if (window.validateWorkflowUsed) window.validateWorkflowUsed();
    }
  }

  // ----------------------------------------------------------
  // SOP DISPLAY NAME HELPER
  // ----------------------------------------------------------

  /**
   * Derives a human-readable name from a SOP URL or file path.
   * Handles SharePoint URLs (the `?file=` query param) and
   * plain UNC/local paths.
   */
  function getSOPDisplayName(link) {
    if (!link || typeof link !== "string") return "SOP";

    try {
      if (/^https?:\/\//i.test(link)) {
        const url = new URL(link);
        const spFile = url.searchParams.get("file");

        if (spFile) {
          return decodeURIComponent(spFile)
            .replace(/[-_]/g, " ")
            .replace(/\.[a-z0-9]+$/i, "");
        }

        const last = url.pathname.split("/").filter(Boolean).pop();
        if (last) {
          return decodeURIComponent(last)
            .replace(/[-_]/g, " ")
            .replace(/\.[a-z0-9]+$/i, "");
        }
      }

      const file = link.split(/[\\/]/).pop();
      if (file) {
        return file.replace(/[-_]/g, " ").replace(/\.[a-z0-9]+$/i, "");
      }
    } catch {
      // Ignore malformed URLs — fall through to default.
    }

    return "SOP";
  }

  // ----------------------------------------------------------
  // SOP VIEW RENDERER
  // ----------------------------------------------------------

  function updateSOPview(selectedList) {
    const container = $id("sopLinksContainer");
    if (!container) return;

    container.innerHTML = "";

    let list = selectedList;
    if (typeof list === "string") list = [list];
    if (!Array.isArray(list) || !list.length) return;

    list.forEach((name) => {
      // Admin-configured SOP takes priority; fall back to detected SOP.
      const adminEntry = WORKFLOW_DATA.find((w) => w.workflow === name);
      const adminSOP = Array.isArray(adminEntry?.sop) ? adminEntry.sop : [];

      const detectedEntry = window.lastDetectedWorkflows?.find(
        (w) => w.workflow === name,
      );
      const detectedSOP = Array.isArray(detectedEntry?.sop)
        ? detectedEntry.sop
        : [];

      const finalSOP = adminSOP.length ? adminSOP : detectedSOP;
      if (!finalSOP.length) return;

      const card = templates.sopCard();
      card.querySelector(".sop-card-title").textContent = name;

      const linkContainer = card.querySelector(".sop-card-links");

      finalSOP.forEach((link) => {
        const frag = templates.sopLink();
        const linkEl = frag.querySelector("a");
        if (!linkEl) return;

        linkEl.href = "#";
        linkEl.textContent = "📄 " + getSOPDisplayName(link);

        linkEl.addEventListener("click", (e) => {
          e.preventDefault();

          if (!link || typeof link !== "string") {
            console.warn("Invalid SOP link:", link);
            return;
          }

          if (window.electronAPI?.openSOP) {
            window.electronAPI.openSOP(link);
          } else {
            console.error("electronAPI.openSOP not available");
          }
        });

        linkContainer.appendChild(frag);
      });

      container.appendChild(card);
    });
  }

  // ----------------------------------------------------------
  // APPLY DETECTED WORKFLOWS
  // ----------------------------------------------------------

  /**
   * Receives the output of the backend workflow detection scan,
   * renders compact workflow cards, auto-fills the TomSelect
   * dropdown, and renders the matching SOPs.
   *
   * Called by scan.js after a limited scan completes.
   * If the UI is not ready yet, scan.js caches the result in
   * window.PENDING_DETECTED_WORKFLOWS and this function flushes
   * it once TomSelect has initialised.
   */
  window.applyDetectedWorkflows = function (detectedData) {
    if (!window.WORKFLOW_UI_READY) {
      console.warn("Workflow UI not ready — skipping auto-apply.");
      return;
    }

    try {
      const container = $id("workflowResult");
      container.innerHTML = "";

      const ts = workflowSelect.tomselect;
      const detected = Array.isArray(detectedData?.workflows)
        ? detectedData.workflows
        : [];

      window.lastDetectedWorkflows = detected;

      // Suppress change events while we programmatically add items.
      ts.onChangeDisabled = true;

      if (!detected.length) {
        // No workflow matched — show guidance notice.
        const notice = document.createElement("div");
        notice.className = "workflow-guidance subtle";
        notice.innerHTML = `
          <div class="workflow-info secondary">
            <strong>ℹ Workflow selection required</strong><br>
            Automatic detection could not determine a matching workflow for this dataset.
            Please review the available workflows and select the most appropriate one(s).
          </div>
        `;
        container.appendChild(notice);

        const infoNotice = $id("workflowInfoNotice");
        if (infoNotice) infoNotice.style.display = "flex";

        ts.onChangeDisabled = false;
        updateSOPview([]);

        if (window.validateWorkflowUsed) window.validateWorkflowUsed();
        return;
      }

      // Sort by score descending before rendering.
      detected.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

      // Render compact workflow cards.
      const detectedBox = templates.detectedBox();

      detectedBox.querySelector(".detected-workflow-box").innerHTML = `
        <div class="workflow-compact-row">
          ${detected
            .map((d) => {
              const score = d.totalScore ?? 0;
              const tooltipHtml = `
              <b>${escapeHtml(d.workflow)}</b><br><br>
              Score: <b>${score}</b><br><br>
              Detected by evaluating rules across files within the same folder.
            `.trim();

              return `
              <div class="workflow-compact-card">
                <div class="workflow-compact-title">✔ ${escapeHtml(d.workflow)}</div>
                <div class="workflow-compact-score">
                  Score ${score}
                  <span class="workflow-tooltip">
                    ⓘ
                    <span class="workflow-tooltip-box">${tooltipHtml}</span>
                  </span>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      `;

      container.appendChild(detectedBox);

      const infoNotice = $id("workflowInfoNotice");
      if (infoNotice) infoNotice.style.display = "flex";

      // Auto-fill TomSelect with detected workflows.
      detected.forEach((item) => {
        if (!ts.items.includes(item.workflow)) ts.addItem(item.workflow);
      });

      ts.onChangeDisabled = false;

      // Sync dropdown options with the current WORKFLOW_DATA.
      ts.clearOptions();
      WORKFLOW_DATA.forEach((w) =>
        ts.addOption({ value: w.workflow, text: w.workflow }),
      );
      ts.refreshOptions(false);

      // Render SOPs for the now-selected workflows.
      updateSOPview(ts.getValue());

      if (window.validateWorkflowUsed) window.validateWorkflowUsed();
    } catch (err) {
      console.warn("Auto workflow + SOP mapping failed:", err);
    }
  };

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  window.loadWorkflowOptions = loadWorkflowOptions;
  window.updateSOPview = updateSOPview;
  window.resetWorkflowDetection = resetWorkflowDetection;

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------

  document.addEventListener("DOMContentLoaded", loadAdminWorkflowJSON);
})();
