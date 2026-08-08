(() => {
  /** @param {any} evaluation */
  function valid(evaluation) {
    return (
      ["ready", "exhausted"].includes(evaluation?.retry_state) &&
      Number.isSafeInteger(evaluation.pre_start_attempt_count) &&
      evaluation.pre_start_attempt_count >= 0 &&
      (evaluation.exhausted_at === null ||
        typeof evaluation.exhausted_at === "string") &&
      (evaluation.retry_error === null ||
        (typeof evaluation.retry_error?.code === "string" &&
          typeof evaluation.retry_error.detail === "string")) &&
      (evaluation.retry_state !== "exhausted" ||
        (evaluation.exhausted_at !== null && evaluation.retry_error !== null))
    );
  }

  /** @param {any} evaluation */
  function status(evaluation) {
    if (evaluation.retry_state !== "exhausted") {
      return null;
    }
    return (
      "retry exhausted — " +
      evaluation.retry_error.code +
      ": " +
      evaluation.retry_error.detail
    );
  }

  /**
   * @param {HTMLElement} row
   * @param {any} evaluation
   * @param {() => Promise<void>} reload
   * @param {any} operator
   */
  function appendCancel(row, evaluation, reload, operator) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel " + evaluation.id;
    cancel.title = "Cancel " + evaluation.id;
    cancel.addEventListener("click", async () => {
      const response = await fetch(
        "/api/v1/evaluations/" + encodeURIComponent(evaluation.id) + "/cancel",
        {
          headers: { "x-quality-bar-csrf": operator.csrfToken() },
          method: "POST",
        },
      );
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        return;
      }
      await reload();
    });
    row.append(cancel);
  }

  /**
   * @param {HTMLElement} row
   * @param {any} evaluation
   * @param {() => Promise<void>} reload
   * @param {any} operator
   */
  function appendRetry(row, evaluation, reload, operator) {
    if (evaluation.retry_state !== "exhausted") {
      return;
    }
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry " + evaluation.id;
    retry.title = "Retry " + evaluation.id;
    retry.addEventListener("click", async () => {
      const response = await fetch(
        "/api/v1/evaluations/" + encodeURIComponent(evaluation.id) + "/retry",
        {
          headers: {
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
      await reload();
    });
    row.append(retry);
  }

  Reflect.set(window, "qualityBarEvaluationActiveControls", {
    appendCancel,
    appendRetry,
    status,
    valid,
  });
})();
