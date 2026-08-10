{
  /**
   * @typedef {{
   *   api_url?: string,
   *   assignment_count?: number,
   *   credential_type: "forge_connection" | "none" | "username_token",
   *   deletion_eligible: boolean,
   *   forge_connection_id?: string,
   *   forge_repository_id?: number,
   *   health: "healthy" | "error",
   *   health_error: null | { code: string, message: string },
   *   id: string,
   *   lifecycle: "enabled" | "disabled" | "retired",
   *   name?: string,
   *   provider?: "forgejo" | "github",
   *   url: string,
   *   verified_at?: number,
   *   web_url?: string
   * }} DetailRepository
   */

  /** @param {string} id */
  function element(id) {
    const found = document.getElementById(id);
    if (!found) {
      throw new Error("repository_detail_control_unavailable");
    }
    return found;
  }

  /** @param {string} id */
  function control(id) {
    return /** @type {HTMLElement & { value: string, requestSubmit: () => void }} */ (
      element(id)
    );
  }

  const repositories = /** @type {{
   *   find: (id: string) => DetailRepository | undefined,
   *   ready: () => Promise<unknown>,
   *   subscribe: (subscriber: (repositories: DetailRepository[]) => unknown) => void,
   *   syncDeleteAvailability: () => void
   * }} */ (Reflect.get(window, "qualityBarRepositories"));

  const nameEl = element("repository-detail-name");
  const stateEl = element("repository-detail-state");
  const errorEl = element("repository-detail-error");
  const metaEl = element("repository-detail-meta");
  const actionsEl = element("repository-detail-actions");
  const resultEl = element("repository-detail-result");
  const guidanceEl = element("repository-detail-guidance");
  const guidanceEmptyEl = element("repository-detail-guidance-empty");
  const guidanceRawEl = element("repository-detail-guidance-raw");

  const repositoryId = new URLSearchParams(window.location.search).get(
    "repository_id",
  );

  const lifecycleLabels = /** @type {const} */ ({
    enabled: "Enable",
    disabled: "Disable",
    retired: "Retire",
  });
  let observed = false;
  let guidanceRequested = false;

  /** @param {string} message */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  /** @param {DetailRepository} repository */
  function isForge(repository) {
    return (
      repository.provider === "github" || repository.provider === "forgejo"
    );
  }

  /** @param {DetailRepository} repository */
  function credentialLabel(repository) {
    if (repository.credential_type === "forge_connection") {
      return "Provider connection";
    }
    if (repository.credential_type === "username_token") {
      return "Username and token";
    }
    return "None";
  }

  /** @param {string} term @param {string} value @param {boolean} [mono] */
  function metaCell(term, value, mono) {
    const cell = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    if (mono) {
      dd.className = "mono";
    }
    dd.textContent = value;
    cell.append(dt);
    cell.append(dd);
    return cell;
  }

  /**
   * @param {string} label
   * @param {() => void} handler
   * @param {boolean} [danger]
   */
  function actionButton(label, handler, danger) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (danger) {
      button.className = "repo-detail__danger";
    }
    button.addEventListener("click", handler);
    return button;
  }

  /**
   * Drive the clipped lifecycle form so the detail action reuses the exact
   * confirmation, request, and reconciliation behavior.
   * @param {DetailRepository} repository
   * @param {DetailRepository["lifecycle"]} lifecycle
   */
  function applyLifecycle(repository, lifecycle) {
    control("repository-lifecycle-repository").value = repository.id;
    control("repository-lifecycle-state").value = lifecycle;
    control("repository-lifecycle-form").requestSubmit();
  }

  /**
   * @param {DetailRepository} repository
   * @param {string} username
   * @param {string} token
   */
  function rotateCredential(repository, username, token) {
    control("repository-credential-rotate-repository").value = repository.id;
    control("repository-credential-rotate-username").value = username;
    control("repository-credential-rotate-token").value = token;
    control("repository-credential-rotate-form").requestSubmit();
  }

  /** @param {DetailRepository} repository */
  function requestDeletion(repository) {
    control("repository-lifecycle-repository").value = repository.id;
    repositories.syncDeleteAvailability();
    control("repository-delete").click();
  }

  /** @param {DetailRepository} repository */
  function renderActions(repository) {
    actionsEl.replaceChildren();
    for (const lifecycle of /** @type {DetailRepository["lifecycle"][]} */ ([
      "enabled",
      "disabled",
      "retired",
    ])) {
      if (lifecycle === repository.lifecycle) {
        continue;
      }
      actionsEl.append(
        actionButton(lifecycleLabels[lifecycle], () => {
          resultEl.textContent = "";
          applyLifecycle(repository, lifecycle);
        }),
      );
    }

    if (repository.credential_type === "username_token") {
      const credential = document.createElement("div");
      credential.className = "repo-detail__credential";
      credential.hidden = true;
      const username = document.createElement("input");
      username.type = "text";
      username.setAttribute("autocomplete", "off");
      username.setAttribute("aria-label", "Replacement username");
      username.setAttribute("placeholder", "Username");
      const token = document.createElement("input");
      token.type = "password";
      token.setAttribute("autocomplete", "off");
      token.setAttribute("aria-label", "Replacement token");
      token.setAttribute("placeholder", "Token");
      const save = actionButton("Save credential", () => {
        rotateCredential(repository, username.value, token.value);
        username.value = "";
        token.value = "";
        credential.hidden = true;
      });
      credential.append(username);
      credential.append(token);
      credential.append(save);
      actionsEl.append(
        actionButton("Rotate credential", () => {
          credential.hidden = !credential.hidden;
        }),
      );
      actionsEl.append(credential);
    }

    if (repository.deletion_eligible) {
      actionsEl.append(
        actionButton("Delete", () => requestDeletion(repository), true),
      );
    }
  }

  /** @param {DetailRepository} repository */
  function renderDetail(repository) {
    errorEl.hidden = true;
    nameEl.textContent = isForge(repository)
      ? /** @type {string} */ (repository.name)
      : repository.url;
    const lifecycle =
      repository.lifecycle.charAt(0).toUpperCase() +
      repository.lifecycle.slice(1);
    stateEl.textContent =
      repository.health === "healthy"
        ? `${lifecycle} · Healthy`
        : `${lifecycle} · Health error`;

    const cells = [];
    if (isForge(repository)) {
      cells.push(
        metaCell(
          "Provider",
          repository.provider === "github" ? "GitHub" : "Forgejo",
        ),
        metaCell(
          "Connection",
          /** @type {string} */ (repository.forge_connection_id),
          true,
        ),
        metaCell(
          "Forge repository",
          `#${repository.forge_repository_id}`,
          true,
        ),
        metaCell("Clone URL", repository.url, true),
        metaCell("Web URL", /** @type {string} */ (repository.web_url), true),
        metaCell("API URL", /** @type {string} */ (repository.api_url), true),
        metaCell(
          "Assignments",
          String(repository.assignment_count ?? "—"),
          true,
        ),
        metaCell(
          "Latest verification",
          Number.isSafeInteger(repository.verified_at)
            ? new Date(
                /** @type {number} */ (repository.verified_at),
              ).toISOString()
            : "—",
          true,
        ),
      );
    } else {
      cells.push(
        metaCell("Provider", "Generic HTTPS Git"),
        metaCell("Clone URL", repository.url, true),
      );
    }
    cells.push(metaCell("Credential", credentialLabel(repository)));
    cells.push(
      metaCell(
        "Health",
        repository.health === "healthy"
          ? "Healthy"
          : `${repository.health_error?.message ?? "Error"}`,
      ),
    );
    metaEl.replaceChildren();
    for (const cell of cells) {
      metaEl.append(cell);
    }

    renderActions(repository);
  }

  /** @param {unknown} value */
  function guidanceReviews(value) {
    const document_ =
      value && typeof value === "object"
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
    return Array.isArray(document_.reviews)
      ? /** @type {Array<Record<string, any>>} */ (document_.reviews)
      : [];
  }

  /** @param {Record<string, any>} review */
  function renderGuidanceReview(review) {
    const item = document.createElement("li");
    item.className = "repo-guidance__item";

    const head = document.createElement("div");
    head.className = "repo-guidance__head";
    const name = document.createElement("span");
    name.className = "repo-guidance__name";
    name.textContent = typeof review.name === "string" ? review.name : "Review";
    head.append(name);

    const criteria = Array.isArray(review.criteria) ? review.criteria : [];
    const blocking = criteria.filter(
      (/** @type {any} */ criterion) => criterion?.impact === "blocking",
    ).length;
    const advisory = criteria.length - blocking;
    const version = review.active_version?.number;
    const applicability =
      review.applicability?.type === "unconditional"
        ? "always applies"
        : "conditional";
    const assignment =
      review.assignment?.scope === "repository_set"
        ? "repository-specific"
        : "installation-wide";
    const meta = document.createElement("span");
    meta.className = "repo-guidance__meta";
    meta.textContent =
      (Number.isSafeInteger(version) ? `v${version} · ` : "") +
      `${blocking} blocking · ${advisory} advisory · ${applicability} · ${assignment}`;
    head.append(meta);
    item.append(head);

    if (criteria.length > 0) {
      const list = document.createElement("ol");
      list.className = "repo-guidance__criteria";
      for (const criterion of criteria) {
        const criterionItem = document.createElement("li");
        criterionItem.className = "repo-guidance__criterion";
        const impact = document.createElement("span");
        impact.className =
          "repo-guidance__impact repo-guidance__impact--" +
          (criterion?.impact === "blocking" ? "blocking" : "advisory");
        impact.title =
          criterion?.impact === "blocking" ? "Blocking" : "Advisory";
        const instruction = document.createElement("p");
        instruction.className = "repo-guidance__instruction";
        instruction.textContent =
          typeof criterion?.instruction === "string"
            ? criterion.instruction
            : "";
        criterionItem.append(impact);
        criterionItem.append(instruction);
        list.append(criterionItem);
      }
      item.append(list);
    }
    return item;
  }

  async function loadGuidance() {
    if (guidanceRequested || !repositoryId) {
      return;
    }
    guidanceRequested = true;
    let response;
    try {
      response = await fetch(
        `/api/v1/repositories/${encodeURIComponent(repositoryId)}/guidance`,
      );
    } catch {
      guidanceRequested = false;
      return;
    }
    if (!response.ok) {
      guidanceRequested = false;
      return;
    }
    const document_ = await response.json();
    guidanceRawEl.textContent = JSON.stringify(document_, null, 2);
    const reviews = guidanceReviews(document_);
    guidanceEmptyEl.hidden = reviews.length > 0;
    guidanceEl.replaceChildren();
    for (const review of reviews) {
      guidanceEl.append(renderGuidanceReview(review));
    }
  }

  if (!repositoryId) {
    showError("Repository was not specified");
  } else {
    repositories.subscribe((current) => {
      const repository = current.find(
        (candidate) => candidate.id === repositoryId,
      );
      if (repository) {
        observed = true;
        renderDetail(repository);
        void loadGuidance();
      } else if (observed) {
        window.location.assign("/?view=repositories");
      }
    });
    void repositories.ready().then((loaded) => {
      if (loaded && !observed) {
        showError("Repository was not found");
      }
    });
  }
}
