// pdf.js — FINAL VERSION WITH COVER LOGO + PAGE NUMBERS + WATERMARK + FOOTER
(() => {
  "use strict";

  // ----------------------------------------------------------
  // CONSTANTS
  // ----------------------------------------------------------
  const BRAND_COLOR = [0, 45, 90]; // Consilio navy
  const PAGE_MARGIN_X = 20;
  const PAGE_MARGIN_Y = 20;

  const PDF_IMAGE_RULES = {
    maxWidth: 170, // mm (A4 safe width)
    minWidth: 90, // mm (prevents tiny images)
    marginX: PAGE_MARGIN_X,
    marginY: PAGE_MARGIN_Y,
  };

  // ----------------------------------------------------------
  // DEJAVU FONT  — loaded once from local assets, never hard-coded
  //
  // WHY: jsPDF's default font (Helvetica) cannot render
  // non-Latin / extended Unicode characters — they come out
  // as garbled boxes.  Embedding DejaVu Sans guarantees every
  // glyph renders correctly regardless of the host OS or browser.
  //
  // The font file is fetched from assets/fonts/DejaVuSans.ttf,
  // converted to Base64, and injected via addFileToVFS.
  // Subsequent calls to generatePDF() reuse the cached string.
  // ----------------------------------------------------------
  const DEJAVU_LOCAL = "assets/fonts/DejaVuSans.ttf";

  let _dejavuBase64Cache = null; // populated once, reused

  async function loadDejaVuFont() {
    if (_dejavuBase64Cache) return _dejavuBase64Cache;

    const response = await fetch(DEJAVU_LOCAL);
    if (!response.ok)
      throw new Error(
        `Failed to load DejaVu font from ${DEJAVU_LOCAL}: ${response.status}`,
      );

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Convert binary → Base64 in chunks to avoid call-stack overflow
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }

    _dejavuBase64Cache = btoa(binary);
    return _dejavuBase64Cache;
  }

  // ----------------------------------------------------------
  // LOGO
  // ----------------------------------------------------------
  let _logoBase64Cache = null;

  function loadLogo() {
    return new Promise((resolve) => {
      if (_logoBase64Cache) {
        resolve();
        return;
      }

      const img = new Image();
      img.src = "assets/logos/consilio-logo_pdf.png";

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        _logoBase64Cache = canvas.toDataURL("image/png");
        resolve();
      };

      img.onerror = () => {
        console.warn("Logo missing — continuing without logo.");
        resolve();
      };
    });
  }

  // ----------------------------------------------------------
  // TEXT HELPERS
  // ----------------------------------------------------------
  function pdfSafeText(str) {
    if (!str) return "";
    return String(str)
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ \f\v]+/g, " ")
      .trim();
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? pdfSafeText(el.value || el.textContent) : "N/A";
  }

  function safeWorkflowList() {
    const ts = window.workflowUsed?.tomselect;
    if (!ts) return "None";
    const arr = ts.getValue();
    return Array.isArray(arr) && arr.length ? arr.join(", ") : "None";
  }

  function getSystemDetectedWorkflows() {
    const arr = window.SYSTEM_DETECTED_WORKFLOWS;
    return Array.isArray(arr) && arr.length ? arr.join("\n") : "None";
  }

  function buildPdfFileName() {
    const safeAlpha = (
      document.getElementById("alphaCode")?.value?.trim() || "NA"
    ).replace(/[^A-Za-z0-9]/g, "");
    const safeTask = (
      document.getElementById("taskNumber")?.value?.trim() || "NA"
    ).replace(/[^A-Za-z0-9]/g, "");
    return `${safeAlpha}_${safeTask}_Media_Analysis_Report.pdf`;
  }

  // ----------------------------------------------------------
  // PAGE DECORATORS
  // ----------------------------------------------------------
  function setDejaVu(doc, size) {
    doc.setFont("DejaVu", "normal");
    doc.setFontSize(size);
  }

  function drawTopBanner(doc) {
    if (_logoBase64Cache) {
      doc.addImage(_logoBase64Cache, "PNG", 16, 5, 44, 18);
    }
    doc.setTextColor(0, 0, 0);
  }

  function drawWatermark(doc) {
    setDejaVu(doc, 80);
    doc.setTextColor(230, 230, 230);
    doc.text(
      "CONSILIO",
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height / 2,
      { align: "center", angle: 315 },
    );
    doc.setTextColor(0, 0, 0);
  }

  function drawFooter(doc, pageNumber, pageCount) {
    const pageH = doc.internal.pageSize.height;
    const pageW = doc.internal.pageSize.width;
    setDejaVu(doc, 10);
    doc.setTextColor(120, 120, 120);
    doc.text("Confidential — Consilio", pageW / 2, pageH - 12, {
      align: "center",
    });
    doc.text(`Page ${pageNumber} of ${pageCount}`, pageW - 20, pageH - 12, {
      align: "right",
    });
    doc.setTextColor(0, 0, 0);
  }

  function sectionHeader(doc, text, y) {
    doc.setFillColor(...BRAND_COLOR);
    doc.rect(14, y, 182, 10, "F");
    setDejaVu(doc, 13);
    doc.setTextColor(255, 255, 255);
    doc.text(text, 18, y + 7);
    doc.setTextColor(0, 0, 0);
  }

  // ----------------------------------------------------------
  // AUTOTABLE DEFAULTS
  // ----------------------------------------------------------
  function tableDefaults(extra = {}) {
    return {
      theme: "grid",
      styles: {
        font: "DejaVu",
        fontSize: 11,
        cellPadding: 4,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        font: "DejaVu",
        fillColor: BRAND_COLOR,
        textColor: 255,
      },
      bodyStyles: { font: "DejaVu" },
      columnStyles: { 1: { cellWidth: 120 } },
      head: [["Field", "Value"]],
      ...extra,
    };
  }

  // ----------------------------------------------------------
  // IMAGE HELPERS
  // ----------------------------------------------------------
  function addAutoScaledImageToPDF(doc, imgData, startY) {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const maxWidth = Math.min(
          PDF_IMAGE_RULES.maxWidth,
          pageW - PDF_IMAGE_RULES.marginX * 2,
        );

        let targetW = Math.max(maxWidth, PDF_IMAGE_RULES.minWidth);
        let targetH = (img.height / img.width) * targetW;

        if (startY + targetH > pageH - PDF_IMAGE_RULES.marginY) {
          doc.addPage();
          startY = PDF_IMAGE_RULES.marginY;
        }

        doc.addImage(
          img,
          "PNG",
          (pageW - targetW) / 2,
          startY,
          targetW,
          targetH,
          undefined,
          "FAST",
        );

        resolve(startY + targetH + 6);
      };

      img.src = imgData;
    });
  }

  // ----------------------------------------------------------
  // MAIN PDF GENERATOR
  // ----------------------------------------------------------
  window.generatePDF = async function () {
    // Parallel-load font + logo
    const [dejavuBase64] = await Promise.all([loadDejaVuFont(), loadLogo()]);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ compress: true });

    // Register DejaVu font (real bytes, not a placeholder)
    doc.addFileToVFS("DejaVuSans.ttf", dejavuBase64);
    doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
    setDejaVu(doc, 12);

    // ---- Gather form values ----
    const nowUTC =
      new Date().toLocaleString("en-GB", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }) + " UTC";

    const datatype = val("datatype");
    const alpha = val("alphaCode");
    const task = val("taskNumber");
    const restriction =
      document.getElementById("projectRestrictionsRequired")?.value || "None";
    const mediaDetails = (() => {
      const el = document.getElementById("mediaDetails");
      return el && el.value.trim() ? pdfSafeText(el.value) : "N/A";
    })();
    const workflowsUsed = safeWorkflowList();
    const overlayRequired = val("overlayRequired");
    const overlayTicket = val("overlayTicket");

    // ---- File count rows (only when data exists) ----
    const totalFiles = pdfSafeText(
      document.getElementById("totalFiles")?.textContent,
    );
    const totalSizeGB = pdfSafeText(
      document.getElementById("totalSizeGB")?.textContent,
    );
    const totalSizeBytes = pdfSafeText(
      document.getElementById("totalSizeBytes")?.textContent,
    );
    const fileExtensions = Array.isArray(window.LAST_SCANNED_EXTENSIONS)
      ? window.LAST_SCANNED_EXTENSIONS.slice()
          .sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" }),
          )
          .join(", ")
      : "N/A";

    const fileCountRows = [
      ["Total Files", totalFiles],
      ["Size (GB)", totalSizeGB],
      ["Size (Bytes)", totalSizeBytes],
      ["Extensions", fileExtensions],
    ].filter(([, v]) => v && v !== "N/A");

    // ==========================================================
    // PAGE 1 — COVER
    // ==========================================================
    const pageW = doc.internal.pageSize.getWidth();

    drawWatermark(doc);
    drawTopBanner(doc);

    let y = 45;

    setDejaVu(doc, 20);
    doc.text("MEDIA ANALYSIS REPORT", pageW / 2, y, { align: "center" });
    y += 14;

    setDejaVu(doc, 12);
    doc.text("Generated by Consilio Media Analysis Platform", pageW / 2, y, {
      align: "center",
    });
    y += 22;

    sectionHeader(doc, "Project Overview", y);
    y += 15;

    doc.autoTable({
      ...tableDefaults(),
      startY: y,
      body: [
        ["Datatype", datatype],
        ["Alpha Code", alpha],
        ["Task / SD Number", task],
        ["Date Generated", nowUTC],
      ],
    });

    // ==========================================================
    // PAGE 2 — PROJECT INFORMATION
    // ==========================================================
    doc.addPage();
    drawWatermark(doc);
    sectionHeader(doc, "Project Information", 20);

    doc.autoTable({
      ...tableDefaults(),
      startY: 32,
      body: [
        ["Datatype", datatype],
        ["Alpha Code", alpha],
        ["Task / SD Number", task],
        ["Project Restriction", restriction],
        ["Media Details", mediaDetails],
        ...fileCountRows,
        ["Detected by System", getSystemDetectedWorkflows()],
        ["Workflows Used (User Selected)", workflowsUsed],
        ["Overlay Required?", overlayRequired],
        ["Overlay Ticket Number", overlayTicket],
      ],
    });

    // ==========================================================
    // PAGE 3 — EXTRACTED FOLDERS (if any)
    // ==========================================================
    const folders =
      typeof window.getFolderPaths === "function"
        ? window.getFolderPaths()
        : [];

    if (folders.length > 0) {
      doc.addPage();
      drawWatermark(doc);
      sectionHeader(doc, "Extracted Folders", 20);

      doc.autoTable({
        startY: 32,
        theme: "grid",
        headStyles: { fillColor: BRAND_COLOR },
        styles: { font: "DejaVu", fontSize: 11, cellPadding: 4 },
        head: [["#", "Folder Path"]],
        body: folders.map((p, i) => [i + 1, pdfSafeText(p)]),
      });
    }

    // ==========================================================
    // SCREENSHOTS & EVIDENCE
    // ==========================================================
    const imgs = Array.isArray(window.images) ? window.images : [];

    if (imgs.length) {
      doc.addPage();
      drawWatermark(doc);
      sectionHeader(doc, "Screenshots & Evidence", 20);

      let imgY = 40;
      for (const imgData of imgs) {
        try {
          imgY = await addAutoScaledImageToPDF(doc, imgData, imgY);
        } catch (e) {
          console.warn("Failed to embed screenshot:", e);
        }
      }
    }

    // ==========================================================
    // FOOTER + PAGE NUMBERS (applied to every page at the end)
    // ==========================================================
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      drawFooter(doc, i, pageCount);
    }

    doc.save(buildPdfFileName());
  };
})();
