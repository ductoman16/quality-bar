"use strict";

const systemAttention = document.getElementById("attention");

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
  if (!systemAttention) {
    throw new Error("system_attention_missing");
  }
  if (storage.status === "unavailable") {
    systemAttention.hidden = false;
    systemAttention.textContent =
      "Storage reserve unavailable: " +
      storage.reserve_bytes +
      " bytes reserved";
    return;
  }
  if (detail.codex.status === "unavailable") {
    systemAttention.hidden = false;
    systemAttention.textContent = "Codex unavailable";
  }
});
