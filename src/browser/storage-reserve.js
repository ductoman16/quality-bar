"use strict";

const reserveFacts = document.getElementById("storage-reserve-facts");

/** @param {number} bytes */
function humanizeReserveBytes(bytes) {
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${units[unit]}`;
}

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
  reserveDescription.textContent = humanizeReserveBytes(storage.reserve_bytes);
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
      humanizeReserveBytes(filesystem.available_bytes) +
      " available — " +
      filesystem.status;
    reserveFacts.append(term, description);
  }
});
