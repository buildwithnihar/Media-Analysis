// validation.js — Form validation (main dashboard + admin)

(() => {
  "use strict";

  // ----------------------------------------------------------
  // DOM HELPERS
  // ----------------------------------------------------------

  const $id = (id) => document.getElementById(id);

  // Only the info template is used; error messages are built inline.
  const infoTemplate = () => $id("infoTemplate").content.cloneNode(true);

  // ----------------------------------------------------------
  // ERROR RENDERING
  // ----------------------------------------------------------

  /**
   * Inserts a validation-error div immediately after `el`.
   * Clears any existing error on that element first.
   */
  function renderError(el, text) {
    if (!el) return;
    clearError(el);
    const msg = document.createElement("div");
    msg.className = "validation-error";
    msg.textContent = text;
    el.insertAdjacentElement("afterend", msg);
  }

  function renderInfo(el, text) {
    if (!el) return;
    clearError(el);
    const frag = infoTemplate();
    frag.querySelector(".validation-info").textContent = text;
    el.insertAdjacentElement(
      "afterend",
      frag.querySelector(".validation-info"),
    );
  }

  /** Removes a validation-error sibling immediately after `el`. */
  function clearError(el) {
    if (!el) return;
    const next = el.nextElementSibling;
    if (next && next.classList.contains("validation-error")) next.remove();
  }

  // ----------------------------------------------------------
  // FOCUS FIRST ERROR
  // ----------------------------------------------------------

  function focusFirstValidationError() {
    const error = document.querySelector(".validation-error:not(:empty)");
    if (!error) return;

    error.scrollIntoView({ behavior: "smooth", block: "center" });

    const relatedInput =
      error.previousElementSibling ||
      error.closest(".form-group")?.querySelector("input, select, textarea");

    if (relatedInput && typeof relatedInput.focus === "function") {
      setTimeout(() => relatedInput.focus({ preventScroll: true }), 300);
    }

    error.classList.add("validation-flash");
    setTimeout(() => error.classList.remove("validation-flash"), 1200);
  }

  window.focusFirstValidationError = focusFirstValidationError;

  // ----------------------------------------------------------
  // PATH UTILITIES (exposed globally for use in folders.js)
  // ----------------------------------------------------------

  /**
   * Normalises a folder path string:
   *   - strips surrounding quotes
   *   - converts forward slashes to backslashes
   *   - collapses runs of backslashes
   *   - removes trailing slash (except bare UNC roots)
   *   - strips spaces adjacent to slashes
   */
  function cleanFolderPath(path) {
    if (!path) return "";

    let p = path.trim();

    p = p.replace(/^["'""]+|["'""]+$/g, "");
    p = p.replace(/\//g, "\\");
    p = p.replace(/\\+/g, "\\");

    // Preserve bare UNC roots (\\server\share) but strip trailing slash elsewhere.
    if (!/^\\\\[^\\]+\\[^\\]+$/.test(p)) {
      p = p.replace(/\\$/, "");
    }

    p = p.replace(/\\\s+/g, "\\");
    p = p.replace(/\s+\\/g, "\\");

    return p;
  }

  window.cleanFolderPath = cleanFolderPath;

  /**
   * Returns an error string if `path` contains Windows-illegal
   * characters, or null if the path is clean.
   */
  function validateFolderCharacters(path) {
    const matches = path.match(/[*?<>|"]/g);
    if (matches) {
      return "Invalid character(s) found: " + [...new Set(matches)].join(" ");
    }
    return null;
  }

  window.validateFolderCharacters = validateFolderCharacters;

  // ----------------------------------------------------------
  // INDIVIDUAL FIELD VALIDATORS
  // ----------------------------------------------------------

  /**
   * Validates the workflow name input in the admin panel.
   * Returns true immediately if the field does not exist on this page.
   */
  function validateWorkflowName() {
    const input = $id("workflowName");
    if (!input) return true;

    const value = input.value.trim();

    if (!value) {
      renderError(input, "Workflow name cannot be empty.");
      return false;
    }

    if (value.length < 3) {
      renderError(input, "Workflow name must be at least 3 characters.");
      return false;
    }

    clearError(input);
    return true;
  }

  function validateAlphaCode() {
    const input = $id("alphaCode");
    const value = (input.value || "").trim();

    if (!value) {
      renderError(input, "Alpha Code is required.");
      return false;
    }

    if (!/^[A-Za-z][0-9]{1,6}$/.test(value)) {
      renderError(
        input,
        "Alpha Code must start with one letter followed by numbers only (e.g., A12345).",
      );
      return false;
    }

    clearError(input);
    return true;
  }

  function validateTaskNumber() {
    const input = $id("taskNumber");
    const value = (input.value || "").trim();

    if (!value) {
      renderError(input, "Task / SD Number is required.");
      return false;
    }

    if (!/^(SD|CST|RITM|PRC|PRI)[0-9]+$/.test(value)) {
      renderError(
        input,
        "Task number must start with SD, CST, PRC, PRI or RITM followed by numbers only.",
      );
      return false;
    }

    clearError(input);
    return true;
  }

  function validateDatatype() {
    const select = $id("datatype");

    if (!select.value) {
      renderError(select, "Data Type is required.");
      return false;
    }

    clearError(select);
    return true;
  }

  function validateFolderPaths() {
    const area = $id("folderPathsArea");
    const folders = window.getFolderPaths();

    if (!folders.length) {
      renderError(area, "At least one valid folder path is required.");
      return false;
    }

    for (const folder of folders) {
      const bad = validateFolderCharacters(folder);
      if (bad) {
        renderError(area, `Invalid folder path "${folder}". ${bad}`);
        return false;
      }
    }

    const lower = folders.map((f) => f.toLowerCase());
    const duplicates = lower.filter((f, idx) => lower.indexOf(f) !== idx);

    if (duplicates.length > 0) {
      renderError(area, "Duplicate folder paths are not allowed.");
      return false;
    }

    clearError(area);
    return true;
  }

  function validateWorkflowUsed() {
    const select = $id("workflowUsed");
    if (!select || !select.tomselect) return true;

    const selected = select.tomselect.getValue();
    const control = select.tomselect.control;

    clearError(control);
    control.classList.remove("has-error");

    // Auto-detected workflows count as a valid selection.
    if (
      (!selected || selected.length === 0) &&
      window.lastDetectedWorkflows?.length
    ) {
      return true;
    }

    if (!selected || selected.length === 0) {
      renderError(control, "At least one workflow must be selected.");
      return false;
    }

    return true;
  }

  function validateProjectRestrictions() {
    const select = $id("projectRestrictionsRequired");

    if (!select.value) {
      renderError(select, "Please select a project restriction.");
      return false;
    }

    clearError(select);
    return true;
  }

  // ----------------------------------------------------------
  // OVERLAY VALIDATORS (exposed globally for overlay.js)
  // ----------------------------------------------------------

  function validateOverlayTicket() {
    const required = $id("overlayRequired")?.value === "Yes";
    const ticket = $id("overlayTicket");
    const err = $id("overlayTicketError");

    if (!required) {
      if (err) err.textContent = "";
      return true;
    }

    if (!ticket || !ticket.value.trim()) {
      if (err) err.textContent = "Overlay ticket number is required.";
      return false;
    }

    if (!/^(RITM|SD|CST)[0-9]{1,15}$/i.test(ticket.value.trim())) {
      if (err) {
        err.textContent =
          "Overlay ticket must start with RITM, SD, or CST followed by numbers (max 15 characters).";
      }
      return false;
    }

    if (err) err.textContent = "";
    return true;
  }

  function validateOverlayRequired() {
    const sel = $id("overlayRequired");
    const error = $id("overlayRequiredError");

    if (!sel.value) {
      if (error) error.textContent = "Please choose Yes or No.";
      return false;
    }

    if (error) error.textContent = "";
    return true;
  }

  // Expose to overlay.js and scan.js
  window.validateOverlayTicket = validateOverlayTicket;
  window.validateOverlayRequired = validateOverlayRequired;

  // ----------------------------------------------------------
  // MASTER VALIDATORS (exposed globally)
  // ----------------------------------------------------------

  /** Pre-scan validation — runs before the file analysis flow. */
  window.validateScanConfig = function () {
    let isValid = true;

    if (!validateDatatype()) isValid = false;
    if (!validateAlphaCode()) isValid = false;
    if (!validateTaskNumber()) isValid = false;
    if (!validateFolderPaths()) isValid = false;
    if (!validateProjectRestrictions()) isValid = false;

    return isValid;
  };

  /** Pre-PDF validation — runs all fields including overlay and workflow. */
  window.validateAllFields = function () {
    let isValid = true;

    if (!validateDatatype()) isValid = false;
    if (!validateAlphaCode()) isValid = false;
    if (!validateTaskNumber()) isValid = false;
    if (!validateFolderPaths()) isValid = false;
    if (!validateWorkflowUsed()) isValid = false;
    if (!validateOverlayTicket()) isValid = false;
    if (!validateOverlayRequired()) isValid = false;
    if (!validateProjectRestrictions()) isValid = false;

    return isValid;
  };

  /** Admin panel workflow-create validation. */
  window.validateWorkflowCreate = function () {
    const isValid = validateWorkflowName();

    if (!isValid && typeof window.focusFirstValidationError === "function") {
      window.focusFirstValidationError();
    }

    return isValid;
  };

  /** Validates form then triggers PDF generation. */
  window.validateAndGenerate = function () {
    if (!window.validateAllFields()) {
      console.warn("Validation failed — PDF will not generate.");
      if (typeof window.focusFirstValidationError === "function") {
        window.focusFirstValidationError();
      }
      return;
    }

    console.log("All validations passed — generating PDF.");

    if (typeof window.generatePDF === "function") {
      window.generatePDF();
    } else {
      console.error("generatePDF() is not defined.");
    }
  };

  // ----------------------------------------------------------
  // AUTO-UPPERCASE HANDLER
  // Fields that must be stored in uppercase regardless of input.
  // Note: this shares the delegated input listener with the
  // individual field validators below to avoid double-firing
  // validateOverlayTicket / validateTaskNumber / validateAlphaCode.
  // ----------------------------------------------------------

  document.addEventListener("input", (e) => {
    const id = e.target?.id;

    if (id === "overlayTicket") {
      e.target.value = e.target.value.toUpperCase();
      validateOverlayTicket();
    } else if (id === "taskNumber") {
      e.target.value = e.target.value.toUpperCase();
      validateTaskNumber();
    } else if (id === "alphaCode") {
      e.target.value = e.target.value.toUpperCase();
      validateAlphaCode();
    }
  });

  // ----------------------------------------------------------
  // LIVE EVENT BINDINGS
  // ----------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    // Admin panel: workflow name
    const workflowInput = $id("workflowName");
    workflowInput?.addEventListener("input", validateWorkflowName);
    workflowInput?.addEventListener("blur", validateWorkflowName);

    // Basic form fields
    // Note: alphaCode, taskNumber, and overlayTicket are validated
    // through the delegated document "input" listener above to avoid
    // double-firing. Only the alpha-path cross-check is added here.
    $id("alphaCode")?.addEventListener("input", () => {
      if (typeof checkAlphaCodeAgainstPaths === "function") {
        checkAlphaCodeAgainstPaths();
      }
    });

    $id("datatype")?.addEventListener("change", validateDatatype);

    // Folder paths
    $id("folderPathsArea")?.addEventListener("input", () => {
      validateFolderPaths();

      if (typeof checkAlphaCodeAgainstPaths === "function") {
        checkAlphaCodeAgainstPaths();
      }

      const status = $id("scanStatus");
      if (status) status.textContent = "";

      if (window.hideResultsTable) window.hideResultsTable();
    });

    // Overlay
    $id("overlayRequired")?.addEventListener("change", () => {
      validateOverlayRequired();
      validateOverlayTicket();
    });

    // overlaySection covers dynamically injected overlayTicket input.
    // Uppercase + validation for overlayTicket is handled by the
    // delegated document "input" listener to avoid double-firing.
    $id("overlaySection")?.addEventListener("input", (e) => {
      if (e.target?.id !== "overlayTicket") validateOverlayTicket();
    });

    // Project restrictions
    $id("projectRestrictionsRequired")?.addEventListener(
      "change",
      validateProjectRestrictions,
    );

    // Workflow dropdown (TomSelect — wait for it to initialise)
    const wf = $id("workflowUsed");
    if (wf) {
      const waitForTomSelect = () => {
        if (wf.tomselect) {
          wf.tomselect.on("change", validateWorkflowUsed);
        } else {
          setTimeout(waitForTomSelect, 100);
        }
      };
      waitForTomSelect();
    }
  });

  // ----------------------------------------------------------
  // DISABLED VALIDATORS (preserved for reference)
  //
  // function validateMediaDetails() { ... }
  // function validatePastedScreenshots() { ... }
  //
  // Uncomment + add to validateAllFields() when needed.
  // ----------------------------------------------------------
})();
