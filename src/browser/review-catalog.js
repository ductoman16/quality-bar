{
  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   description?: string,
   *   archived?: boolean,
   *   assignment?: {
   *     scope: "installation_wide" | "repository_set",
   *     repository_ids?: string[]
   *   },
   *   active_version?: {
   *     number?: number,
   *     applicability_rule?: string | null,
   *     codex_configuration?: { model?: string },
   *     criteria?: Array<{ impact?: string, instruction?: string }>
   *   },
   *   versions?: Array<{ number?: number }>
   * }} CatalogReview
   */

  /** @param {string} id */
  function element(id) {
    const found = document.getElementById(id);
    if (!found) {
      throw new Error("review_catalog_control_unavailable");
    }
    return found;
  }

  const catalog = element("review-catalog");
  const loading = element("review-catalog-loading");
  const empty = element("review-catalog-empty");
  const summary = element("review-catalog-summary");
  const failure = element("review-catalog-error");

  /** @param {unknown} value */
  const text = (value) => (typeof value === "string" ? value : "");

  /** @param {string} tag @param {string} className @param {string} [value] */
  function node(tag, className, value) {
    const created = document.createElement(tag);
    if (className) {
      created.className = className;
    }
    if (value !== undefined) {
      created.textContent = value;
    }
    return created;
  }

  /** @param {CatalogReview} review */
  function versionNumber(review) {
    const number = review.active_version?.number;
    return Number.isSafeInteger(number) ? "v" + number : "v—";
  }

  /** @param {CatalogReview} review */
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

  /** @param {CatalogReview} review */
  function impactCounts(review) {
    const criteria = review.active_version?.criteria ?? [];
    let blocking = 0;
    let advisory = 0;
    for (const criterion of criteria) {
      if (criterion?.impact === "blocking") {
        blocking += 1;
      } else if (criterion?.impact === "advisory") {
        advisory += 1;
      }
    }
    return { total: criteria.length, blocking, advisory };
  }

  /** @param {string} reviewId */
  const detailUrl = (reviewId) =>
    "/?view=review-detail&review_id=" + encodeURIComponent(reviewId);

  /**
   * Compact read-only preview: the criteria at a glance, with a link to the
   * dedicated detail page for anything more.
   * @param {CatalogReview} review
   */
  function expandedDetail(review) {
    const detail = node("div", "review-expanded");
    const criteria = review.active_version?.criteria ?? [];
    const list = node("ol", "review-criteria-read");
    if (criteria.length === 0) {
      list.append(node("li", "review-criteria-read__empty", "No criteria"));
    }
    for (const criterion of criteria) {
      const item = node("li", "review-criteria-read__item");
      const impact = criterion?.impact === "blocking" ? "blocking" : "advisory";
      const mark = node("span", "review-impact review-impact--" + impact);
      mark.setAttribute("aria-hidden", "true");
      const badge = node("span", "review-impact-label", impact);
      const instruction = node(
        "p",
        "review-criteria-read__text",
        text(criterion?.instruction),
      );
      const head = node("div", "review-criteria-read__head");
      head.append(mark, badge);
      item.append(head, instruction);
      list.append(item);
    }
    const link = node("a", "review-expanded__link", "View details");
    link.setAttribute("href", detailUrl(review.id));
    detail.append(list, link);
    return detail;
  }

  /** @param {CatalogReview} review @param {number} index */
  function row(review, index) {
    const article = node(
      "article",
      "review-row" + (review.archived ? " review-row--archived" : ""),
    );
    article.setAttribute("data-review-id", review.id);
    const panelId = "review-catalog-panel-" + index;

    const toggle = node("button", "review-row__toggle");
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", panelId);
    toggle.setAttribute("aria-label", "Inspect review " + review.name);
    toggle.append(node("span", "review-row__chevron"));

    const mark = node(
      "span",
      "review-row__mark review-row__mark--" +
        (review.archived ? "archived" : "active"),
    );
    mark.setAttribute("aria-hidden", "true");

    const name = node("span", "review-row__name", review.name);
    const state = node(
      "span",
      "review-row__state",
      review.archived ? "Archived" : "Active",
    );
    const identity = node("div", "review-row__identity");
    identity.append(mark, name, state);

    const counts = impactCounts(review);
    const criteria = node("span", "review-row__criteria");
    criteria.append(
      node(
        "span",
        "review-row__criteria-total",
        counts.total + (counts.total === 1 ? " criterion" : " criteria"),
      ),
      node(
        "span",
        "review-row__criteria-split",
        counts.blocking + " blocking · " + counts.advisory + " advisory",
      ),
    );

    const open = node("a", "review-row__open", "›");
    open.setAttribute("href", detailUrl(review.id));
    open.setAttribute("aria-label", "Open review " + review.name);

    const summaryGrid = node("div", "review-row__summary");
    summaryGrid.append(
      toggle,
      identity,
      node("span", "review-row__scope", scopeLabel(review)),
      criteria,
      node("span", "review-row__version", versionNumber(review)),
      node(
        "span",
        "review-row__model",
        text(review.active_version?.codex_configuration?.model) || "—",
      ),
      open,
    );
    article.append(summaryGrid);

    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isOpen));
      const existing = document.getElementById(panelId);
      if (existing) {
        existing.remove();
        return;
      }
      const panel = expandedDetail(review);
      panel.id = panelId;
      article.append(panel);
    });
    return article;
  }

  /** @param {CatalogReview[]} reviews */
  function render(reviews) {
    catalog.replaceChildren();
    reviews.forEach((review, index) => catalog.append(row(review, index)));
    empty.hidden = reviews.length !== 0;
    const active = reviews.filter((review) => !review.archived).length;
    summary.textContent =
      reviews.length === 0
        ? ""
        : reviews.length +
          (reviews.length === 1 ? " review" : " reviews") +
          " · " +
          active +
          " active";
  }

  async function load() {
    failure.hidden = true;
    let response;
    try {
      response = await fetch("/api/v1/reviews");
    } catch {
      loading.hidden = true;
      failure.hidden = false;
      failure.textContent = "Reviews failed to load";
      return;
    }
    loading.hidden = true;
    if (!response.ok) {
      failure.hidden = false;
      failure.textContent = "Reviews failed to load";
      return;
    }
    const body = /** @type {{ reviews?: unknown }} */ (await response.json());
    if (!Array.isArray(body.reviews)) {
      failure.hidden = false;
      failure.textContent = "Reviews returned an invalid response";
      return;
    }
    render(/** @type {CatalogReview[]} */ (body.reviews));
  }

  document.addEventListener("quality-bar:system-loaded", () => {
    void load();
  });
  document.addEventListener("quality-bar:review-created", (event) => {
    const created =
      event instanceof CustomEvent
        ? event.detail
        : /** @type {unknown} */ (null);
    const id =
      created && typeof created === "object" && "id" in created
        ? /** @type {{ id?: unknown }} */ (created).id
        : null;
    if (typeof id === "string" && id.length > 0) {
      window.location.assign(detailUrl(id));
      return;
    }
    void load();
  });
  document.addEventListener("quality-bar:review-updated", () => {
    if (!document.getElementById("review-catalog")) {
      return;
    }
    void load();
  });
}
