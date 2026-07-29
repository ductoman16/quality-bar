(() => {
  /** @param {any} adjudication */
  function describeStatus(adjudication) {
    if (
      !adjudication ||
      typeof adjudication.id !== "string" ||
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
        typeof adjudication.error?.code !== "string" ||
        typeof adjudication.error?.detail !== "string"
      ) {
        throw new Error("waiver_adjudication_invalid");
      }
      status +=
        " Error " + adjudication.error.code + ": " + adjudication.error.detail;
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

  Reflect.set(window, "qualityBarWaiverBatch", { createForm, describeStatus });
})();
