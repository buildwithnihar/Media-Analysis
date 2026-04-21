// ui-init.js
(() => {
  "use strict";

  const $id = (id) => document.getElementById(id);
  const $qs = (selector) => document.querySelector(selector);

  // ============================
  // DATATYPE DROPDOWN
  // ============================
  const datatype = $id("datatype");

  if (datatype) {
    datatype.innerHTML = "";

    const opts = [
      { value: "", label: "Select Datatype" },
      { value: "Standard NUIX", label: "Standard NUIX" },
      { value: "Data Mapping", label: "Data Mapping" },
    ];

    opts.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label; // safe — no innerHTML
      datatype.appendChild(option);
    });
  }

  // ============================
  // BUTTON WIRING
  // ============================
  const genBtn = $id("generatePdfBtn");
  if (genBtn) {
    genBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof window.validateAndGenerate === "function") {
        window.validateAndGenerate();
      } else {
        console.warn("validateAndGenerate() missing.");
      }
    });
  }

  const loadBtn = $qs('[onclick="loadResults()"]');
  if (loadBtn) {
    loadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof loadResults === "function") {
        loadResults();
      } else {
        console.warn("loadResults() missing.");
      }
    });
  }
})();

// ============================
// ALPHA CODE PATH VALIDATOR
// ============================
function checkAlphaCodeAgainstPaths() {
  const alphaInput = document.getElementById("alphaCode");
  const warningBox = document.getElementById("scanWarnings");

  if (!alphaInput || !warningBox) return;

  const alpha = alphaInput.value.trim().toLowerCase();

  if (!alpha) {
    warningBox.innerHTML = "";
    return;
  }

  const allPaths = [...document.querySelectorAll("#folderContainer textarea")]
    .map((t) => t.value || "")
    .join("\n");

  if (!allPaths.trim()) {
    warningBox.innerHTML = "";
    return;
  }

  warningBox.innerHTML = allPaths.toLowerCase().includes(alpha)
    ? ""
    : `⚠️ Alpha Code <strong>${alpha.toUpperCase()}</strong> does not appear in the extracted folder paths.
       Please verify that the selected dataset is correct.`;
}
