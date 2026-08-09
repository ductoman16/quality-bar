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

  /** @param {string} label @param {string} value */
  function fact(label, value) {
    const wrapper = node("div", "review-fact");
    wrapper.append(
      node("span", "review-fact__label", label),
      node("span", "review-fact__value", value),
    );
    return wrapper;
  }

  /** @param {CatalogReview} review */
  function expandedDetail(review) {
    const detail = node("div", "review-expanded");

    const reviewGroup = node("div", "review-owner");
    reviewGroup.append(node("div", "review-owner__title", "Review"));
    const reviewFacts = node("div", "review-facts");
    reviewFacts.append(
      fact("Assignment", scopeLabel(review)),
      fact("State", review.archived ? "Archived" : "Active"),
    );
    reviewGroup.append(reviewFacts);

    const number = review.active_version?.number;
    const versionGroup = node("div", "review-owner review-owner--version");
    versionGroup.append(
      node(
        "div",
        "review-owner__title",
        "Active version" +
          (Number.isSafeInteger(number) ? " · v" + number : ""),
      ),
    );

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

    const rule = review.active_version?.applicability_rule;
    const applicability = node("div", "review-applicability-read");
    applicability.append(node("span", "review-fact__label", "Applies when"));
    if (typeof rule === "string" && rule.trim().length > 0) {
      applicability.append(
        node("pre", "review-applicability-read__rule", rule),
      );
    } else {
      applicability.append(
        node("span", "review-applicability-read__always", "Always applies"),
      );
    }

    const versionFacts = node("div", "review-facts");
    versionFacts.append(
      fact(
        "Codex model",
        text(review.active_version?.codex_configuration?.model) || "—",
      ),
    );
    versionGroup.append(list, applicability, versionFacts);

    const edit = node("button", "review-edit", "Edit in configuration");
    edit.setAttribute("type", "button");
    edit.addEventListener("click", () => openInEditor(review.id));

    detail.append(reviewGroup, versionGroup, edit);
    return detail;
  }

  /** @param {string} reviewId */
  function openInEditor(reviewId) {
    document.dispatchEvent(
      new CustomEvent("review-editor:select", { detail: reviewId }),
    );
    const editor = document.getElementById("reviews-editor");
    if (editor && typeof editor.scrollIntoView === "function") {
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
    );
    article.append(summaryGrid);

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
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
  document.addEventListener("quality-bar:review-created", () => {
    void load();
  });
}
