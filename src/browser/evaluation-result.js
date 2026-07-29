(() => {
  /** @param {unknown} value */
  const nullableString = (value) => value === null || typeof value === "string";

  /** @param {string} focusSearch @param {string} name */
  function focusValue(focusSearch, name) {
    const match = new RegExp("(?:^|[?&])" + name + "=([^&]*)").exec(
      focusSearch,
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  /** @param {any} location */
  function locationText(location) {
    if (location.kind === "changeset") {
      return "Changeset";
    }
    const side = location.side + " " + location.path;
    return location.kind === "line_range"
      ? side + ":" + location.start_line + "-" + location.end_line
      : side;
  }

  /** @param {string} evaluationId @param {any} finding */
  function findingLocation(evaluationId, finding) {
    const location = finding.location;
    const text = locationText(location);
    if (location.kind === "changeset") {
      const value = document.createElement("span");
      value.textContent = text;
      return value;
    }
    const link = document.createElement("a");
    const lineQuery =
      location.kind === "line_range"
        ? "&start_line=" +
          encodeURIComponent(location.start_line) +
          "&end_line=" +
          encodeURIComponent(location.end_line)
        : "";
    link.href =
      "/?view=evaluations&evaluation_id=" +
      encodeURIComponent(evaluationId) +
      "&file_change_id=" +
      encodeURIComponent(location.file_change_id) +
      "&side=" +
      encodeURIComponent(location.side) +
      lineQuery;
    link.textContent = text;
    return link;
  }

  /** @param {any} result @param {any} location */
  function frozenDiff(result, location) {
    const fileChange = result.file_changes.find(
      /** @param {any} candidate */
      (candidate) => candidate.id === location.file_change_id,
    );
    if (
      !fileChange ||
      typeof fileChange.patch !== "string" ||
      !nullableString(fileChange.before_path) ||
      !nullableString(fileChange.after_path)
    ) {
      throw new Error("evaluation_result_invalid");
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Frozen diff — " + locationText(location);
    details.append(summary);
    const patch = document.createElement("pre");
    patch.textContent = fileChange.patch;
    details.append(patch);
    return details;
  }

  /** @param {any} run @param {any} diagnostics */
  function reviewRunDiagnostics(run, diagnostics) {
    if (
      !diagnostics ||
      diagnostics.review_run_id !== run.id ||
      !nullableString(diagnostics.codex_cli_version) ||
      typeof diagnostics.duration_ms !== "number" ||
      !diagnostics.process ||
      typeof diagnostics.process.kind !== "string" ||
      !diagnostics.token_counters ||
      !Array.isArray(diagnostics.transcript_chunks)
    ) {
      throw new Error("review_run_diagnostics_invalid");
    }
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent =
      "Review " +
      run.review_id +
      " " +
      run.review_version_id +
      " — diagnostics";
    details.append(summary);
    const counters = diagnostics.token_counters;
    const counterText = (/** @type {unknown} */ value) =>
      Number.isSafeInteger(value) ? String(value) : "unavailable";
    const processText =
      diagnostics.process.kind === "exit" &&
      Number.isSafeInteger(diagnostics.process.code)
        ? "exit " + diagnostics.process.code
        : diagnostics.process.kind === "signal" &&
            typeof diagnostics.process.signal === "string"
          ? "signal " + diagnostics.process.signal
          : "process unavailable";
    const measurements = document.createElement("p");
    measurements.textContent =
      "Codex CLI " +
      (diagnostics.codex_cli_version ?? "unavailable") +
      " — " +
      diagnostics.duration_ms +
      " ms — input " +
      counterText(counters.input_tokens) +
      ", cached input " +
      counterText(counters.cached_input_tokens) +
      ", output " +
      counterText(counters.output_tokens) +
      " — " +
      processText;
    details.append(measurements);
    for (const stream of ["stdout", "stderr"]) {
      const chunks = diagnostics.transcript_chunks.filter(
        /** @param {any} chunk */
        (chunk) => {
          if (
            !Number.isSafeInteger(chunk?.sequence) ||
            !["stdout", "stderr"].includes(chunk?.stream) ||
            typeof chunk?.content !== "string"
          ) {
            throw new Error("review_run_diagnostics_invalid");
          }
          return chunk.stream === stream;
        },
      );
      if (chunks.length === 0) {
        continue;
      }
      const transcript = document.createElement("details");
      const transcriptSummary = document.createElement("summary");
      transcriptSummary.textContent = stream === "stdout" ? "Stdout" : "Stderr";
      transcript.append(transcriptSummary);
      const content = document.createElement("pre");
      content.textContent = chunks
        .map((/** @type {any} */ chunk) => chunk.content)
        .join("");
      transcript.append(content);
      details.append(transcript);
    }
    return details;
  }

  /** @param {string} evaluationId @param {any} run */
  async function loadReviewRunDiagnostics(evaluationId, run) {
    const response = await fetch(
      "/api/v1/evaluations/" +
        encodeURIComponent(evaluationId) +
        "/review-runs/" +
        encodeURIComponent(run.id) +
        "/diagnostics",
    );
    if (!response.ok) {
      const failure = await response.json();
      throw new Error(failure.error.message);
    }
    return reviewRunDiagnostics(run, await response.json());
  }

  /** @param {any} target @param {any} evaluation @param {any} result @param {string} focusSearch */
  async function renderResult(target, evaluation, result, focusSearch) {
    if (
      !result ||
      typeof result.outcome !== "string" ||
      !Array.isArray(result.criterion_results) ||
      !Array.isArray(result.file_changes) ||
      !Array.isArray(result.findings) ||
      !Array.isArray(result.review_runs)
    ) {
      throw new Error("evaluation_result_invalid");
    }
    target.textContent = "Result " + result.outcome;
    for (const run of result.review_runs.filter(
      /** @param {any} candidate */
      (candidate) => candidate.status === "failed",
    )) {
      if (
        typeof run.review_id !== "string" ||
        typeof run.review_version_id !== "string" ||
        typeof run.error?.code !== "string" ||
        typeof run.error.detail !== "string"
      ) {
        throw new Error("evaluation_result_invalid");
      }
      const failure = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent =
        "Review " + run.review_id + " " + run.review_version_id + " — failed";
      failure.append(summary);
      const error = document.createElement("p");
      error.textContent = "Error " + run.error.code + ": " + run.error.detail;
      failure.append(error);
      target.append(failure);
    }
    for (const criterion of result.criterion_results) {
      const run = result.review_runs.find(
        /** @param {any} candidate */
        (candidate) => candidate.id === criterion.review_run_id,
      );
      if (
        typeof criterion.criterion_id !== "string" ||
        typeof criterion.outcome !== "string" ||
        typeof run?.review_id !== "string" ||
        typeof run.review_version_id !== "string"
      ) {
        throw new Error("evaluation_result_invalid");
      }
      const criterionDetails = document.createElement("details");
      const criterionSummary = document.createElement("summary");
      const outcomeText =
        criterion.outcome === "not_applicable"
          ? "not applicable"
          : criterion.outcome;
      criterionSummary.textContent =
        "Criterion " +
        criterion.criterion_id +
        " — " +
        outcomeText +
        " — Review " +
        run.review_id +
        " " +
        run.review_version_id;
      criterionDetails.append(criterionSummary);
      if (criterion.outcome === "error") {
        if (
          !criterion.error ||
          typeof criterion.error !== "object" ||
          typeof criterion.error.code !== "string" ||
          typeof criterion.error.detail !== "string"
        ) {
          throw new Error("evaluation_result_invalid");
        }
        const error = document.createElement("p");
        error.textContent =
          "Error " + criterion.error.code + ": " + criterion.error.detail;
        criterionDetails.append(error);
      }
      for (const finding of result.findings.filter(
        /** @param {any} candidate */
        (candidate) =>
          candidate.review_run_id === criterion.review_run_id &&
          candidate.criterion_id === criterion.criterion_id,
      )) {
        if (
          typeof finding.id !== "string" ||
          typeof finding.impact !== "string" ||
          typeof finding.evidence !== "string" ||
          typeof finding.remediation !== "string" ||
          typeof finding.location?.kind !== "string"
        ) {
          throw new Error("evaluation_result_invalid");
        }
        const findingDetails = document.createElement("details");
        const findingSummary = document.createElement("summary");
        findingSummary.textContent =
          "Finding " + finding.id + " — " + finding.impact;
        findingDetails.append(findingSummary);
        for (const [label, value] of [
          ["Evidence", finding.evidence],
          ["Remediation", finding.remediation],
        ]) {
          const fact = document.createElement("p");
          fact.textContent = label + ": " + value;
          findingDetails.append(fact);
        }
        findingDetails.append(findingLocation(evaluation.id, finding));
        const location = finding.location;
        if (
          focusValue(focusSearch, "evaluation_id") === evaluation.id &&
          focusValue(focusSearch, "file_change_id") ===
            location.file_change_id &&
          focusValue(focusSearch, "side") === location.side &&
          (location.kind !== "line_range" ||
            (focusValue(focusSearch, "start_line") ===
              String(location.start_line) &&
              focusValue(focusSearch, "end_line") ===
                String(location.end_line)))
        ) {
          criterionDetails.open = true;
          findingDetails.open = true;
          const diff = frozenDiff(result, location);
          diff.open = true;
          findingDetails.append(diff);
        }
        criterionDetails.append(findingDetails);
      }
      target.append(criterionDetails);
    }
    for (const run of result.review_runs) {
      target.append(await loadReviewRunDiagnostics(evaluation.id, run));
    }
  }

  Reflect.set(window, "qualityBarEvaluationResult", {
    render: renderResult,
  });
})();
