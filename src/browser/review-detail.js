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
  const metaEl = element("review-detail-meta");
  const versionLabel = element("review-editor-active-version");
  const errorEl = element("review-detail-error");

  const reviewId = new URLSearchParams(window.location.search).get("review_id");

  /** @param {unknown} value */
  const text = (value) => (typeof value === "string" ? value : "");

  /** @param {DetailReview} review */
  function scopeLabel(review) {
    const assignment = review.assignment;
    if (!assignment || assignment.scope === "installation_wide") {
      return "Installation-wide";
    }
    const count = Array.isArray(assignment.repository_ids)
      ? assignment.repository_ids.length
      : 0;
    return count === 1 ? "1 repository" : count + " repositories";
  }

  /** @param {string} label @param {string} value @param {boolean} [mono] */
  function metaCell(label, value, mono) {
    const cell = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (mono) {
      dd.className = "mono";
    }
    dd.textContent = value;
    cell.append(dt, dd);
    return cell;
  }

  /** @param {DetailReview} review */
  function render(review) {
    nameEl.textContent = review.name;
    stateEl.textContent = review.archived ? "Archived" : "Active";
    const number = review.active_version?.number;
    versionLabel.textContent = Number.isSafeInteger(number)
      ? " · v" + number
      : "";

    const configuration = review.active_version?.codex_configuration ?? {};
    const criteria = review.active_version?.criteria ?? [];
    const blocking = criteria.filter((c) => c?.impact === "blocking").length;
    const advisory = criteria.filter((c) => c?.impact === "advisory").length;
    const codex = [
      text(configuration.model),
      text(configuration.reasoning_effort),
      text(configuration.service_tier),
    ]
      .filter((value) => value.length > 0)
      .join(" · ");

    metaEl.replaceChildren(
      metaCell("Assignment", scopeLabel(review)),
      metaCell(
        "Active version",
        Number.isSafeInteger(number) ? "v" + number : "—",
        true,
      ),
      metaCell("Codex", codex || "—", true),
      metaCell(
        "Criteria",
        criteria.length +
          (criteria.length === 1 ? " criterion" : " criteria") +
          " · " +
          blocking +
          " blocking · " +
          advisory +
          " advisory",
      ),
    );
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
