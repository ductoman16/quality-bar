/**
 * @param {{
 *   appJwt: (appId: number, pem: string, now: number) => string,
 *   exactPermissions: (value: unknown) => void,
 *   fail: (code: string, message: string) => never,
 *   nonemptyString: (value: unknown, message: string) => string,
 *   now: () => number,
 *   object: (value: unknown) => Record<string, unknown> | null,
 *   request: (path: string, options?: any) => Promise<unknown>
 * }} dependencies
 */
export function createGitHubInstallationToken(dependencies) {
  /** @param {any} credential @param {number} installationId */
  return async function installationToken(credential, installationId) {
    const jwt = dependencies.appJwt(
      credential.app_id,
      credential.pem,
      dependencies.now(),
    );
    const response = dependencies.object(
      await dependencies.request(
        `/app/installations/${installationId}/access_tokens`,
        { authorization: jwt, method: "POST" },
      ),
    );
    if (!response) {
      dependencies.fail(
        "github_api_response_invalid",
        "GitHub installation token response is invalid",
      );
    }
    dependencies.exactPermissions(response.permissions);
    return dependencies.nonemptyString(
      response.token,
      "GitHub installation token response is invalid",
    );
  };
}
