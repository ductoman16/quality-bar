/**
 * @param {{
 *   fail: (code: string, message: string) => never,
 *   nonemptyString: (value: unknown, message: string) => string,
 *   object: (value: unknown) => Record<string, unknown> | null,
 *   principal: (value: unknown) => {id: number, login: string, type: "User"},
 *   request: (path: string, options: any) => Promise<unknown>
 * }} dependencies
 */
export function createGitHubManifestExchange(dependencies) {
  /** @param {string} code */
  return async function exchangeManifest(code) {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(code)) {
      dependencies.fail(
        "github_manifest_callback_invalid",
        "GitHub App Manifest callback is invalid",
      );
    }
    const response = dependencies.object(
      await dependencies.request(
        `/app-manifests/${encodeURIComponent(code)}/conversions`,
        { method: "POST" },
      ),
    );
    if (!response || !Number.isSafeInteger(response.id)) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub App Manifest response is invalid",
      );
    }
    return {
      app_id: /** @type {number} */ (response.id),
      app_slug: dependencies.nonemptyString(
        response.slug,
        "GitHub App Manifest response is invalid",
      ),
      client_id: dependencies.nonemptyString(
        response.client_id,
        "GitHub App Manifest response is invalid",
      ),
      owner: dependencies.principal(response.owner),
      pem: dependencies.nonemptyString(
        response.pem,
        "GitHub App Manifest response is invalid",
      ),
    };
  };
}
