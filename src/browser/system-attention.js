"use strict";

const systemAttention = document.getElementById("attention");

/** @param {number} bytes */
function humanizeAttentionBytes(bytes) {
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
const executionProviderFacts = document.getElementById(
  "execution-provider-facts",
);

/** @param {any} provider */
function validProvider(provider) {
  return (
    provider &&
    typeof provider.id === "string" &&
    typeof provider.name === "string" &&
    ["available", "unavailable"].includes(provider.status) &&
    (provider.status === "available" ||
      (provider.error &&
        typeof provider.error.code === "string" &&
        typeof provider.error.message === "string" &&
        typeof provider.error.recovery === "string"))
  );
}

document.addEventListener("quality-bar:system-loaded", (event) => {
  const detail = /** @type {any} */ (event).detail;
  const storage = detail?.storage;
  if (
    !Array.isArray(detail?.execution_providers) ||
    detail.execution_providers.length === 0 ||
    !detail.execution_providers.every(validProvider) ||
    !storage ||
    !Number.isSafeInteger(storage.reserve_bytes) ||
    !["available", "unavailable"].includes(storage.status)
  ) {
    throw new Error("system_attention_facts_invalid");
  }
  if (!systemAttention) {
    throw new Error("system_attention_missing");
  }
  if (executionProviderFacts) {
    executionProviderFacts.replaceChildren(
      ...detail.execution_providers.flatMap(
        /** @param {any} provider */ (provider) => {
          const term = document.createElement("dt");
          term.textContent = provider.name;
          const description = document.createElement("dd");
          const status = document.createElement("strong");
          status.textContent =
            provider.status === "available" ? "Available" : "Unavailable";
          description.append(status);
          if (provider.error) {
            const problem = document.createElement("span");
            problem.textContent = ` ${provider.error.message} `;
            const recovery = document.createElement("span");
            recovery.textContent = `Fix: ${provider.error.recovery} `;
            const diagnostic = document.createElement("code");
            diagnostic.textContent = provider.error.code;
            description.append(problem, recovery, diagnostic);
          }
          return [term, description];
        },
      ),
    );
  }
  if (storage.status === "unavailable") {
    systemAttention.hidden = false;
    systemAttention.textContent =
      "Storage reserve unavailable: " +
      humanizeAttentionBytes(storage.reserve_bytes) +
      " reserved";
    return;
  }
  const unavailableProviders = detail.execution_providers.filter(
    /** @param {any} provider */ (provider) =>
      provider.status === "unavailable",
  );
  if (unavailableProviders.length > 0) {
    systemAttention.hidden = false;
    systemAttention.textContent =
      unavailableProviders.length === 1
        ? "Execution provider unavailable"
        : `${unavailableProviders.length} execution providers unavailable`;
  }
});
