// overlay.js — Overlay ticket UI logic

(() => {
  "use strict";

  const $id = (id) => document.getElementById(id);

  // ----------------------------------------------------------
  // OVERLAY TICKET — MOUNT / SHOW / HIDE
  // ----------------------------------------------------------

  /**
   * Clones the overlay ticket template into #overlaySection
   * if it has not already been mounted.
   * Returns the container element (or the existing one).
   */
  function mountOverlayTicket() {
    const existing = $id("overlayTicketContainer");
    if (existing) return existing;

    const tpl = $id("overlayTicketTemplate");
    const target = $id("overlaySection");
    if (!tpl || !target) return null;

    target.appendChild(tpl.content.cloneNode(true));

    // Attach live validation to the dynamically injected field.
    const ticket = $id("overlayTicket");
    if (ticket && window.validateOverlayTicket) {
      ticket.addEventListener("input", window.validateOverlayTicket);
    }

    return $id("overlayTicketContainer");
  }

  function showOverlayTicket() {
    const container = mountOverlayTicket();
    if (container) container.style.display = "block";
  }

  function hideOverlayTicket() {
    const err = $id("overlayTicketError");
    const container = $id("overlayTicketContainer");
    if (err) err.textContent = "";
    if (container) container.remove();
  }

  // ----------------------------------------------------------
  // DROPDOWN CHANGE HANDLER
  // ----------------------------------------------------------

  function bindOverlayChange() {
    const sel = $id("overlayRequired");
    if (!sel) return;

    sel.addEventListener("change", () => {
      if (sel.value === "Yes") {
        showOverlayTicket();
      } else {
        hideOverlayTicket();
      }

      if (window.validateOverlayRequired) window.validateOverlayRequired();
      if (window.validateOverlayTicket) window.validateOverlayTicket();
    });
  }

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------

  document.addEventListener("DOMContentLoaded", bindOverlayChange);
})();
