// folders.js — Folder path textarea UI

(() => {
  "use strict";

  // ----------------------------------------------------------
  // DOM HELPER
  // ----------------------------------------------------------

  const $id = (id) => document.getElementById(id);

  // ----------------------------------------------------------
  // MOUNT FOLDER TEXTAREA
  // ----------------------------------------------------------

  /**
   * Clones the folder textarea template into #folderContainer,
   * replacing any previously mounted content.
   * Also attaches the alpha-path cross-check listener.
   */
  function mountFolderTextarea() {
    const tpl = $id("folderTextareaTemplate");
    const container = $id("folderContainer");
    if (!tpl || !container) return;

    container.innerHTML = "";
    container.appendChild(tpl.content.cloneNode(true));

    const ta = container.querySelector("textarea");
    ta?.addEventListener("input", () => {
      if (typeof window.checkAlphaCodeAgainstPaths === "function") {
        window.checkAlphaCodeAgainstPaths();
      }
    });
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Returns the current list of normalised folder paths from the
   * textarea, one per line, with blank lines and whitespace removed.
   * Relies on window.cleanFolderPath from validation.js.
   */
  window.getFolderPaths = function () {
    const ta = $id("folderPathsArea");
    if (!ta) return [];

    return ta.value
      .split(/\r?\n/)
      .map((line) => window.cleanFolderPath(line))
      .filter((line) => line.length > 0);
  };

  /** Re-mounts the folder textarea, resetting any user input. */
  window.resetFolderInputMode = function () {
    mountFolderTextarea();
  };

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    mountFolderTextarea();

    // Run the soft alpha-path warning once the DOM and functions
    // are fully ready. This must be inside DOMContentLoaded to
    // guarantee checkAlphaCodeAgainstPaths is defined by this point.
    if (typeof window.checkAlphaCodeAgainstPaths === "function") {
      window.checkAlphaCodeAgainstPaths();
    }
  });
})();
