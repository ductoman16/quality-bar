{
  /** @param {string} id */
  function element(id) {
    const found = document.getElementById(id);
    if (!found) {
      throw new Error("review_editor_control_unavailable");
    }
    return found;
  }

  const selector = /** @type {HTMLSelectElement} */ (
    element("review-editor-review")
  );
  const versionLabel = element("review-editor-active-version");

  /** @type {Map<string, { number?: number }>} */
  const activeVersionByReview = new Map();
  const editorSelectIds = [
    "review-metadata-review",
    "review-version-review",
    "review-assignment-review",
    "review-archival-review",
  ];

  /** @param {string} reviewId */
  function updateVersionLabel(reviewId) {
    const number = activeVersionByReview.get(reviewId)?.number;
    versionLabel.textContent = Number.isSafeInteger(number)
      ? " · v" + number
      : "";
  }

  /**
   * Drive the legacy per-form pickers from the single context. Only used for an
   * explicit switch (user or catalog); the components self-initialize to the
   * first review on load, so the initial state needs no dispatch.
   * @param {string} reviewId
   */
  function syncTo(reviewId) {
    for (const controlId of editorSelectIds) {
      const control = /** @type {HTMLSelectElement | null} */ (
        document.getElementById(controlId)
      );
      if (
        control &&
        control.value !== reviewId &&
        Array.from(control.options).some((option) => option.value === reviewId)
      ) {
        control.value = reviewId;
        control.dispatchEvent(new Event("change"));
      }
    }
    updateVersionLabel(reviewId);
  }

  selector.addEventListener("change", () => syncTo(selector.value));
  document.addEventListener("review-editor:select", (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      if (
        Array.from(selector.options).some(
          (option) => option.value === event.detail,
        )
      ) {
        selector.value = event.detail;
      }
      syncTo(event.detail);
    }
  });

  async function load() {
    let response;
    try {
      response = await fetch("/api/v1/reviews");
    } catch {
      return;
    }
    if (!response.ok) {
      return;
    }
    const body = /** @type {{ reviews?: unknown }} */ (await response.json());
    if (!Array.isArray(body.reviews)) {
      return;
    }
    const reviews =
      /** @type {Array<{ id: string, name: string, active_version?: { number?: number } }>} */ (
        body.reviews
      );
    activeVersionByReview.clear();
    selector.replaceChildren(
      ...reviews.map((review) => {
        const option = document.createElement("option");
        option.value = review.id;
        option.textContent = review.name;
        activeVersionByReview.set(review.id, {
          number: review.active_version?.number,
        });
        return option;
      }),
    );
    const first = reviews[0];
    if (first) {
      selector.value = first.id;
      updateVersionLabel(first.id);
    }
  }

  document.addEventListener("quality-bar:system-loaded", () => {
    void load();
  });
  document.addEventListener("quality-bar:review-created", () => {
    void load();
  });
}
