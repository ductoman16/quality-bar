"use strict";

const attention = document.getElementById("attention");

document.addEventListener("quality-bar:system-loaded", (event) => {
  const detail = /** @type {any} */ (event).detail;
  const storage = detail?.storage;
  if (
    !detail?.codex ||
    !["available", "unavailable"].includes(detail.codex.status) ||
    !storage ||
    !Number.isSafeInteger(storage.reserve_bytes) ||
    !["available", "unavailable"].includes(storage.status)
  ) {
    throw new Error("system_attention_facts_invalid");
  }
  if (!attention) {
    throw new Error("system_attention_missing");
  }
  if (storage.status === "unavailable") {
    attention.hidden = false;
    attention.textContent =
      "Storage reserve unavailable: " +
      storage.reserve_bytes +
      " bytes reserved";
    return;
  }
  if (detail.codex.status === "unavailable") {
    attention.hidden = false;
    attention.textContent = "Codex unavailable";
  }
});
