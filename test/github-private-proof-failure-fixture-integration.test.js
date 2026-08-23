import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { createGitHubVerifier } from "../src/github/github-api.js";
import { GitHubConnectionError } from "../src/github/github-connection-error.js";

const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};
/** @param {string} name @param {number} id @param {boolean} private_ */
const repository = (name, id, private_) => ({
  clone_url: `https://github.com/operator/${name}.git`,
  full_name: `operator/${name}`,
  html_url: `https://github.com/operator/${name}`,
  id,
  owner: { id: 91, login: "operator", type: "User" },
  private: private_,
  url: `https://api.github.com/repos/operator/${name}`,
});

test("public selection preserves exact mandatory private-proof failure context", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /** @type {string[]} */
  const gitReads = [];
  const verifier = createGitHubVerifier({
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/app") {
        return Response.json({
          events: [],
          id: 47,
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          permissions,
          public: false,
          slug: "quality-bar-personal",
        });
      }
      if (path === "/app/installations") {
        return Response.json([
          {
            account: { id: 91, login: "operator", type: "User" },
            app_id: 47,
            events: [],
            id: 73,
            permissions,
            repository_selection: "selected",
            suspended_at: null,
            target_type: "User",
          },
        ]);
      }
      if (path === "/app/installations/73/access_tokens") {
        return Response.json({ permissions, token: "installation-token" });
      }
      if (path === "/installation/repositories") {
        return Response.json({
          repositories: [
            repository("private", 101, true),
            repository("public", 202, false),
          ],
          total_count: 2,
        });
      }
      if (path.startsWith("/repos/operator/private/")) {
        return Response.json({ message: "forbidden" }, { status: 403 });
      }
      if (path.startsWith("/repos/operator/public/")) {
        return Response.json([]);
      }
      throw new Error(`unexpected fixture path: ${path}`);
    },
    now: () => 2_000_000_000_000,
    async verifyGit(url) {
      gitReads.push(url);
    },
  });
  const credential = {
    app_id: 47,
    app_slug: "quality-bar-personal",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: /** @type {const} */ ("User") },
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };

  await assert.rejects(
    () => verifier.verifyRepositories(credential, 73, [202]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_request_failed" &&
      error.repositoryId === 101 &&
      JSON.stringify(error.affectedRepositoryIds) ===
        JSON.stringify([202, 101]) &&
      JSON.stringify(error.completedRepositoryIds) === JSON.stringify([202]) &&
      error.repositoryEvidence?.length === 2 &&
      /** @type {any[]} */ (error.repositoryEvidence)[0]?.api_url ===
        "https://api.github.com/repos/operator/private",
  );
  assert.deepEqual(gitReads, ["https://github.com/operator/public.git"]);
});
