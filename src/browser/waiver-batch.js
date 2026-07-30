(() => {
  /** @param {unknown} value */
  const canonicalNonblank = (value) =>
    typeof value === "string" && value.length > 0 && value === value.trim();

  /** @param {unknown} value */
  const nonblank = (value) =>
    typeof value === "string" && value.trim().length > 0;

  /** @param {unknown} value */
  const stableCode = (value) =>
    typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value);

  /** @param {any} adjudication */
  function describeStatus(adjudication) {
    if (
      !adjudication ||
      !canonicalNonblank(adjudication.id) ||
      !["queued", "running", "completed", "failed", "cancelled"].includes(
        adjudication.execution_status,
      )
    ) {
      throw new Error("waiver_adjudication_invalid");
    }
    let status =
      "Waiver Adjudication " +
      adjudication.id +
      " " +
      adjudication.execution_status +
      ".";
    if (adjudication.execution_status === "failed") {
      if (
        !stableCode(adjudication.error?.code) ||
        !nonblank(adjudication.error?.detail)
      ) {
        throw new Error("waiver_adjudication_invalid");
      }
      status +=
        " Error " + adjudication.error.code + ": " + adjudication.error.detail;
    }
    if (adjudication.execution_status === "completed") {
      if (
        !Array.isArray(adjudication.decisions) ||
        adjudication.decisions.length === 0
      ) {
        throw new Error("waiver_adjudication_invalid");
      }
      status += " Decisions:";
      for (const decision of adjudication.decisions) {
        if (
          !canonicalNonblank(decision?.id) ||
          !canonicalNonblank(decision.request_id) ||
          !["accepted", "denied", "error"].includes(decision.outcome)
        ) {
          throw new Error("waiver_adjudication_invalid");
        }
        if (decision.outcome === "error") {
          if (
            !stableCode(decision.error?.code) ||
            !canonicalNonblank(decision.error.detail)
          ) {
            throw new Error("waiver_adjudication_invalid");
          }
          status +=
            " " +
            decision.request_id +
            " error " +
            decision.error.code +
            ": " +
            decision.error.detail;
        } else {
          if (!canonicalNonblank(decision.explanation)) {
            throw new Error("waiver_adjudication_invalid");
          }
          status +=
            " " +
            decision.request_id +
            " " +
            decision.outcome +
            ": " +
            decision.explanation;
        }
      }
    }
    return status;
  }

  /**
   * @param {string} evaluationId
   * @param {{findingId: string, rationale: any}[]} rationales
   */
  function createForm(evaluationId, rationales) {
    const form = document.createElement("form");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Submit waiver batch";
    form.append(submit);
    const status = document.createElement("output");
    status.setAttribute("aria-live", "polite");
    form.append(status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "";
      const requests = rationales
        .filter(({ rationale }) => rationale.value.trim().length > 0)
        .map(({ findingId, rationale }) => ({
          finding_id: findingId,
          rationale: rationale.value,
        }));
      if (requests.length === 0) {
        status.textContent = "Waiver rationale required";
        return;
      }
      const operator = Reflect.get(window, "qualityBarOperator");
      if (
        typeof operator?.csrfToken !== "function" ||
        typeof operator.displayMutationFailure !== "function"
      ) {
        throw new Error("evaluation_operator_boundary_unavailable");
      }
      const response = await fetch(
        "/api/v1/evaluations/" +
          encodeURIComponent(evaluationId) +
          "/waiver-adjudications",
        {
          body: JSON.stringify({ requests }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-quality-bar-csrf": operator.csrfToken(),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        return;
      }
      const created = await response.json();
      status.textContent = describeStatus(created.adjudication);
    });
    return form;
  }

  /** @param {string} evaluationId @param {string[]} requestIds */
  function createErrorRetryForm(evaluationId, requestIds) {
    if (
      !canonicalNonblank(evaluationId) ||
      !Array.isArray(requestIds) ||
      requestIds.length === 0 ||
      requestIds.some((requestId) => !canonicalNonblank(requestId)) ||
      new Set(requestIds).size !== requestIds.length
    ) {
      throw new Error("waiver_error_retry_invalid");
    }
    const form = document.createElement("form");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Retry errored waiver";
    form.append(submit);
    const status = document.createElement("output");
    status.setAttribute("aria-live", "polite");
    form.append(status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "";
      const operator = Reflect.get(window, "qualityBarOperator");
      if (
        typeof operator?.csrfToken !== "function" ||
        typeof operator.displayMutationFailure !== "function"
      ) {
        throw new Error("evaluation_operator_boundary_unavailable");
      }
      const response = await fetch(
        "/api/v1/evaluations/" +
          encodeURIComponent(evaluationId) +
          "/waiver-adjudications/error-retries",
        {
          body: JSON.stringify({ request_ids: requestIds }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-quality-bar-csrf": operator.csrfToken(),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        return;
      }
      const created = await response.json();
      status.textContent = describeStatus(created.adjudication);
    });
    return form;
  }

  Reflect.set(window, "qualityBarWaiverBatch", {
    createErrorRetryForm,
    createForm,
    describeStatus,
  });
})();
