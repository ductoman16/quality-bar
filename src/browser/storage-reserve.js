"use strict";

const reserveFacts = document.getElementById("storage-reserve-facts");

document.addEventListener("quality-bar:system-loaded", (event) => {
  const detail = /** @type {any} */ (event).detail;
  const storage = detail?.storage;
  if (
    !reserveFacts ||
    !storage ||
    !Array.isArray(storage.filesystems) ||
    !Number.isSafeInteger(storage.reserve_bytes) ||
    !["available", "unavailable"].includes(storage.status)
  ) {
    throw new Error("storage_reserve_facts_invalid");
  }
  reserveFacts.textContent = "";
  const reserveTerm = document.createElement("dt");
  reserveTerm.textContent = "Reserved free space";
  const reserveDescription = document.createElement("dd");
  reserveDescription.textContent = storage.reserve_bytes + " bytes";
  reserveFacts.append(reserveTerm, reserveDescription);
  for (const filesystem of storage.filesystems) {
    if (
      !filesystem ||
      !["state", "checkouts"].includes(filesystem.filesystem) ||
      typeof filesystem.path !== "string" ||
      !Number.isSafeInteger(filesystem.available_bytes) ||
      !["available", "unavailable"].includes(filesystem.status)
    ) {
      throw new Error("storage_reserve_facts_invalid");
    }
    const term = document.createElement("dt");
    term.textContent =
      filesystem.filesystem === "state"
        ? "State filesystem"
        : "Checkout filesystem";
    const description = document.createElement("dd");
    description.textContent =
      filesystem.path +
      " — " +
      filesystem.available_bytes +
      " bytes available — " +
      filesystem.status;
    reserveFacts.append(term, description);
  }
});
