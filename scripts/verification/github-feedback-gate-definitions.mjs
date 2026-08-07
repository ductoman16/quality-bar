export const GITHUB_FIXTURE_GATE = {
  name: "github-fixture-integration",
  testGroup:
    "github-rest-profile-personal-installation-permissions-routes-pagination-rate-gates-draft-ready-force-push-retarget-close-merge-and-reopen-observation-exact-frozen-head-stable-commit-status-append-only-aggregate-inline-feedback-and-original-review-comment-waiver-replies-atomic-selection-enumeration-and-private-git-boundary",
  failureCode: "github_fixture_integration_tests_failed",
  arguments: [
    "--test",
    "test/github-fixture-integration.test.js",
    "test/github-commit-status-fixture-integration.test.js",
    "test/github-feedback-fixture-integration.test.js",
    "test/github-polling-fixture-integration.test.js",
    "test/github-private-proof-failure-fixture-integration.test.js",
  ],
};

export const GIT_GATE = {
  name: "git-integration",
  testGroup:
    "generic-and-github-app-https-repository-read-guidance-assignment-retirement-reactivation-deletion-polling-object-identity-pull-request-merge-base-exact-frozen-head-status-and-valid-diff-feedback-force-push-return-to-prior-pair-and-inaccessible-head-boundary",
  failureCode: "git_integration_tests_failed",
  arguments: [
    "--test",
    "test/evaluation-git-object-format-integration.test.js",
    "test/repository-git-integration.test.js",
    "test/github-git-integration.test.js",
    "test/forgejo-automatic-evaluation-git-integration.test.js",
    "test/github-feedback-git-integration.test.js",
    "test/repository-git-credential-integration.test.js",
  ],
};
