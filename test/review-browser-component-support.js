/** @param {Record<string, unknown>} [properties] */
export function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    children: /** @type {unknown[]} */ ([]),
    disabled: false,
    hidden: false,
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    focus() {},
    /** @param {...unknown} children */
    replaceChildren(...children) {
      this.children = children;
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`review_metadata_listener_missing: ${name}`);
      }
      return listener;
    },
  };
}

/** @param {string} code @param {string} message @param {number} status */
export function failureResponse(code, message, status) {
  return {
    ok: false,
    status,
    async json() {
      return { error: { code, message } };
    },
  };
}

/** @param {{id: string, name: string, description: string}} metadata */
export function reviewResource(metadata) {
  return {
    active_version: {
      applicability_rule: null,
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        {
          id: metadata.id + "-criterion",
          impact: "advisory",
          instruction: "Preserve the exact metadata boundary.",
          position: 1,
        },
      ],
      id: metadata.id + "-v1",
      number: 1,
    },
    assignment: { scope: "installation_wide" },
    ...metadata,
  };
}
