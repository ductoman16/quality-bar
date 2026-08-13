{
  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   archived?: boolean,
   *   assignment?: {
   *     scope: "installation_wide" | "repository_set",
   *     repository_ids?: string[]
   *   },
   *   active_version?: {
   *     number?: number,
   *     codex_configuration?: {
   *       model?: string,
   *       reasoning_effort?: string,
   *       service_tier?: string
   *     },
   *     criteria?: Array<{ impact?: string }>
   *   }
   * }} DetailReview
   */

  /** @param {string} id */
  function element(id) {
    const found = document.getElementById(id);
    if (!found) {
      throw new Error("review_detail_control_unavailable");
    }
    return found;
  }

  const nameEl = element("review-detail-name");
  const stateEl = element("review-detail-state");
  const versionLabel = element("review-editor-active-version");
  const errorEl = element("review-detail-error");

  const reviewId = new URLSearchParams(window.location.search).get("review_id");

  // The name heading (identity), the state badge (lifecycle), the "Active
  // version · vN" label, and the editors below each already show these facts,
  // so the detail page carries no separate meta readout.
  /** @param {DetailReview} review */
  function render(review) {
    nameEl.textContent = review.name;
    stateEl.textContent = review.archived ? "Archived" : "Active";
    const number = review.active_version?.number;
    versionLabel.textContent = Number.isSafeInteger(number)
      ? " · v" + number
      : "";
  }

  /** @param {string} url */
  async function fetchReviews(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const body = /** @type {{ reviews?: unknown }} */ (await response.json());
      return Array.isArray(body.reviews)
        ? /** @type {DetailReview[]} */ (body.reviews)
        : [];
    } catch {
      return [];
    }
  }

  async function loadHeader() {
    if (!reviewId) {
      errorEl.hidden = false;
      errorEl.textContent = "Review was not specified";
      return;
    }
    const active = await fetchReviews("/api/v1/reviews");
    let review = active.find((candidate) => candidate.id === reviewId);
    if (!review) {
      const archived = await fetchReviews("/api/v1/reviews?state=archived");
      review = archived.find((candidate) => candidate.id === reviewId);
    }
    if (!review) {
      errorEl.hidden = false;
      errorEl.textContent = "Review was not found";
      return;
    }
    errorEl.hidden = true;
    render(review);
  }

  // The editor components populate their own review selects asynchronously and
  // self-open the first review; drive them to the URL's review once ready.
  function driveToReview() {
    if (!reviewId) {
      return;
    }
    const selectIds = [
      "review-metadata-review",
      "review-version-review",
      "review-assignment-review",
      "review-archival-review",
    ];
    let attempts = 0;
    const tick = () => {
      let pending = false;
      for (const id of selectIds) {
        const control = /** @type {HTMLSelectElement | null} */ (
          document.getElementById(id)
        );
        if (!control) {
          continue;
        }
        const hasOption = Array.from(control.options).some(
          (option) => option.value === reviewId,
        );
        if (!hasOption) {
          pending = true;
        } else if (control.value !== reviewId) {
          control.value = reviewId;
          control.dispatchEvent(new Event("change"));
        }
      }
      attempts += 1;
      if (pending && attempts < 60) {
        setTimeout(tick, 60);
      }
    };
    tick();
  }

  document.addEventListener("quality-bar:system-loaded", () => {
    void loadHeader();
    driveToReview();
  });
}
