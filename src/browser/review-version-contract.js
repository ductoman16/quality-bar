{
  function readBrowserConfiguration() {
    const configuration = /** @type {HTMLScriptElement} */ (
      document.getElementById("browser-configuration")
    );
    if (configuration?.type !== "application/json") {
      throw new Error("browser_configuration_invalid");
    }
    const value = /** @type {{csrfCookieName?: unknown}} */ (
      JSON.parse(configuration.textContent)
    );
    if (
      !value ||
      typeof value.csrfCookieName !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    ) {
      throw new Error("browser_configuration_invalid");
    }
    return value.csrfCookieName;
  }

  /** @param {string} id */
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("browser_control_unavailable");
    }
    return element;
  }

  /** @param {string} id */
  function controlValue(id) {
    const element = requiredElement(id);
    if (!("value" in element) || typeof element.value !== "string") {
      throw new Error("browser_control_unavailable");
    }
    return element.value;
  }

  /** @param {string} id @param {string} value */
  function setControlValue(id, value) {
    const element = requiredElement(id);
    if (!("value" in element)) {
      throw new Error("browser_control_unavailable");
    }
    element.value = value;
  }

  /** @param {unknown} value */
  function requireReview(value) {
    const review =
      /** @type {{id?: unknown, name?: unknown, active_version?: unknown}} */ (
        value
      );
    if (
      !review ||
      typeof review.id !== "string" ||
      typeof review.name !== "string" ||
      !review.active_version ||
      typeof review.active_version !== "object"
    ) {
      throw new Error("Review Version response was invalid");
    }
    const version =
      /** @type {{id?: unknown, number?: unknown, applicability_rule?: unknown, codex_configuration?: unknown, criteria?: unknown}} */ (
        review.active_version
      );
    const configuration =
      /** @type {{model?: unknown, reasoning_effort?: unknown, service_tier?: unknown}} */ (
        version.codex_configuration
      );
    if (
      typeof version.id !== "string" ||
      !Number.isSafeInteger(version.number) ||
      !(
        version.applicability_rule === null ||
        typeof version.applicability_rule === "string"
      ) ||
      !configuration ||
      typeof configuration.model !== "string" ||
      typeof configuration.reasoning_effort !== "string" ||
      typeof configuration.service_tier !== "string" ||
      !Array.isArray(version.criteria) ||
      version.criteria.length === 0 ||
      !version.criteria.every(
        (criterion) =>
          criterion &&
          typeof criterion === "object" &&
          "id" in criterion &&
          typeof criterion.id === "string" &&
          "impact" in criterion &&
          ["advisory", "blocking"].includes(
            /** @type {string} */ (criterion.impact),
          ) &&
          "instruction" in criterion &&
          typeof criterion.instruction === "string",
      )
    ) {
      throw new Error("Review Version response was invalid");
    }
    const completeReview = /** @type {{
     * id: string,
     * name: string,
     * active_version: {
     *   id: string,
     *   number: number,
     *   applicability_rule: string | null,
     *   codex_configuration: {
     *     model: string,
     *     reasoning_effort: string,
     *     service_tier: string
     *   },
     *   criteria: Array<{id: string, impact: string, instruction: string}>
     * }
     * }} */ (review);
    return completeReview;
  }

  /** @param {unknown} value */
  function requireSaveResult(value) {
    const result = /** @type {{changed?: unknown, review?: unknown}} */ (value);
    if (!result || typeof result.changed !== "boolean") {
      throw new Error("Review Version response was invalid");
    }
    return { changed: result.changed, review: requireReview(result.review) };
  }

  const browserDocument =
    /** @type {Document & {qualityBarReviewVersionContract?: unknown}} */ (
      document
    );
  browserDocument.qualityBarReviewVersionContract = {
    controlValue,
    readBrowserConfiguration,
    requiredElement,
    requireReview,
    requireSaveResult,
    setControlValue,
  };
}
