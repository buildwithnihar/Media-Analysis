// paste.js
(() => {
  "use strict";

  // ------------------------------------------
  // CONSTANTS
  // ------------------------------------------
  const MAX_IMAGES = 5;
  const COMPRESS_WIDTH = 1280;
  const COMPRESS_QUALITY = 0.8;

  // ------------------------------------------
  // ELEMENT REFS
  // ------------------------------------------
  const $id = (id) => document.getElementById(id);

  const placeholderTpl = $id("pastePlaceholderTemplate");
  const thumbTpl = $id("pasteThumbTemplate");
  const errorTpl = $id("pasteErrorTemplate");
  const previewContainer = $id("imagePreviewContainer");

  let errorBox = $id("pasteError");

  // ------------------------------------------
  // GLOBAL IMAGE STORE
  // ------------------------------------------
  window.images = window.images || [];

  // ------------------------------------------
  // ERROR BOX
  // ------------------------------------------
  function mountPasteError() {
    if (!errorTpl) return;
    if (!$id("pasteError")) {
      const clone = errorTpl.content.cloneNode(true);
      previewContainer.insertAdjacentElement(
        "afterend",
        clone.firstElementChild,
      );
    }
    errorBox = $id("pasteError");
  }

  function showPasteError(msg) {
    mountPasteError();
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  function clearPasteError() {
    mountPasteError();
    errorBox.textContent = "";
    errorBox.style.display = "none";
  }

  // ------------------------------------------
  // PLACEHOLDER / DROP ZONE
  // ------------------------------------------
  function mountPlaceholder() {
    if (!placeholderTpl || $id("pasteDropZone")) return;
    const clone = placeholderTpl.content.cloneNode(true);
    previewContainer.insertAdjacentElement(
      "beforebegin",
      clone.firstElementChild,
    );
  }

  function updateScreenshotUI() {
    const zone = $id("pasteDropZone");
    if (zone) zone.style.display = window.images.length === 0 ? "flex" : "none";
  }

  // ------------------------------------------
  // IMAGE HELPERS
  // ------------------------------------------
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject("Failed reading file.");
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function compressImage(base64) {
    return new Promise((resolve) => {
      const img = new Image();

      img.onerror = () => resolve(base64);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");

          if (img.width > COMPRESS_WIDTH) {
            canvas.width = COMPRESS_WIDTH;
            canvas.height = Math.round(
              COMPRESS_WIDTH / (img.width / img.height),
            );
          } else {
            canvas.width = img.width;
            canvas.height = img.height;
          }

          canvas
            .getContext("2d")
            .drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", COMPRESS_QUALITY));
        } catch {
          resolve(base64);
        }
      };

      img.src = base64;
    });
  }

  // ------------------------------------------
  // THUMBNAIL
  // ------------------------------------------
  function removeImage(src, wrapper) {
    window.images = window.images.filter((i) => i !== src);
    wrapper?.remove();
    clearPasteError();
    updateScreenshotUI();
    window.validatePastedScreenshots?.();
  }

  function addThumbToDOM(imgData) {
    const clone = thumbTpl.content.cloneNode(true);
    const wrapper = clone.querySelector(".thumb-container");
    const img = clone.querySelector(".thumb-img");
    const btn = clone.querySelector(".remove-btn");

    img.src = imgData;
    btn.onclick = () => removeImage(imgData, wrapper);

    previewContainer.appendChild(wrapper);
    updateScreenshotUI();
    clearPasteError();
    window.validatePastedScreenshots?.();
  }

  // ------------------------------------------
  // PASTE HANDLER
  // ------------------------------------------
  document.addEventListener("paste", async (e) => {
    if (!e.clipboardData) return;

    for (const item of e.clipboardData.items) {
      if (!item.type.startsWith("image/")) continue;

      if (window.images.length >= MAX_IMAGES) {
        showPasteError(`Maximum ${MAX_IMAGES} screenshots allowed.`);
        return;
      }

      const file = item.getAsFile();
      if (!file) continue;

      const raw = await readFileAsDataURL(file);

      if (window.images.includes(raw)) {
        showPasteError("This screenshot has already been added.");
        continue;
      }

      const compressed = await compressImage(raw);

      if (window.images.includes(compressed)) {
        showPasteError("This screenshot has already been added.");
        continue;
      }

      window.images.push(compressed);
      addThumbToDOM(compressed);
    }
  });

  // ------------------------------------------
  // INIT
  // ------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    mountPlaceholder();
    mountPasteError();
    updateScreenshotUI();
  });
})();
