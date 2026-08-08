import { readFileSync } from "node:fs";

const browserAssets = [
  {
    route: "/assets/login.js",
    sourcePath: "src/browser/login.js",
    url: new URL("./browser/login.js", import.meta.url),
  },
  {
    route: "/assets/operator.js",
    sourcePath: "src/browser/operator.js",
    url: new URL("./browser/operator.js", import.meta.url),
  },
  {
    route: "/assets/analytics.js",
    sourcePath: "src/browser/analytics.js",
    url: new URL("./browser/analytics.js", import.meta.url),
  },
  {
    route: "/assets/analytics-contract.js",
    sourcePath: "src/browser/analytics-contract.js",
    url: new URL("./browser/analytics-contract.js", import.meta.url),
  },
  {
    route: "/assets/analytics-matching-facts.js",
    sourcePath: "src/browser/analytics-matching-facts.js",
    url: new URL("./browser/analytics-matching-facts.js", import.meta.url),
  },
  {
    route: "/assets/analytics-state.js",
    sourcePath: "src/browser/analytics-state.js",
    url: new URL("./browser/analytics-state.js", import.meta.url),
  },
  {
    route: "/assets/waiver-batch.js",
    sourcePath: "src/browser/waiver-batch.js",
    url: new URL("./browser/waiver-batch.js", import.meta.url),
  },
  {
    route: "/assets/evaluation-result.js",
    sourcePath: "src/browser/evaluation-result.js",
    url: new URL("./browser/evaluation-result.js", import.meta.url),
  },
  {
    route: "/assets/evaluation-feedback.js",
    sourcePath: "src/browser/evaluation-feedback.js",
    url: new URL("./browser/evaluation-feedback.js", import.meta.url),
  },
  {
    route: "/assets/evaluation-active-controls.js",
    sourcePath: "src/browser/evaluation-active-controls.js",
    url: new URL("./browser/evaluation-active-controls.js", import.meta.url),
  },
  {
    route: "/assets/evaluation-monitor.js",
    sourcePath: "src/browser/evaluation-monitor.js",
    url: new URL("./browser/evaluation-monitor.js", import.meta.url),
  },
  {
    route: "/assets/evaluation.js",
    sourcePath: "src/browser/evaluation.js",
    url: new URL("./browser/evaluation.js", import.meta.url),
  },
  {
    route: "/assets/evaluation-detail.js",
    sourcePath: "src/browser/evaluation-detail.js",
    url: new URL("./browser/evaluation-detail.js", import.meta.url),
  },
  {
    route: "/assets/system-attention.js",
    sourcePath: "src/browser/system-attention.js",
    url: new URL("./browser/system-attention.js", import.meta.url),
  },
  {
    route: "/assets/system-execution.js",
    sourcePath: "src/browser/system-execution.js",
    url: new URL("./browser/system-execution.js", import.meta.url),
  },
  {
    route: "/assets/system-polling-delivery-contract.js",
    sourcePath: "src/browser/system-polling-delivery-contract.js",
    url: new URL(
      "./browser/system-polling-delivery-contract.js",
      import.meta.url,
    ),
  },
  {
    route: "/assets/system-polling-delivery.js",
    sourcePath: "src/browser/system-polling-delivery.js",
    url: new URL("./browser/system-polling-delivery.js", import.meta.url),
  },
  {
    route: "/assets/storage-reserve.js",
    sourcePath: "src/browser/storage-reserve.js",
    url: new URL("./browser/storage-reserve.js", import.meta.url),
  },
  {
    route: "/assets/system-storage.js",
    sourcePath: "src/browser/system-storage.js",
    url: new URL("./browser/system-storage.js", import.meta.url),
  },
  {
    route: "/assets/waiver-adjudicator-configuration.js",
    sourcePath: "src/browser/waiver-adjudicator-configuration.js",
    url: new URL(
      "./browser/waiver-adjudicator-configuration.js",
      import.meta.url,
    ),
  },
  {
    route: "/assets/github-connection-contract.js",
    sourcePath: "src/browser/github-connection-contract.js",
    url: new URL("./browser/github-connection-contract.js", import.meta.url),
  },
  {
    route: "/assets/github-connection-lifecycle-confirmation.js",
    sourcePath: "src/browser/github-connection-lifecycle-confirmation.js",
    url: new URL(
      "./browser/github-connection-lifecycle-confirmation.js",
      import.meta.url,
    ),
  },
  {
    route: "/assets/github-connection-submission.js",
    sourcePath: "src/browser/github-connection-submission.js",
    url: new URL("./browser/github-connection-submission.js", import.meta.url),
  },
  {
    route: "/assets/github-connection.js",
    sourcePath: "src/browser/github-connection.js",
    url: new URL("./browser/github-connection.js", import.meta.url),
  },
  {
    route: "/assets/forgejo-connection-contract.js",
    sourcePath: "src/browser/forgejo-connection-contract.js",
    url: new URL("./browser/forgejo-connection-contract.js", import.meta.url),
  },
  {
    route: "/assets/forgejo-connection-lifecycle-confirmation.js",
    sourcePath: "src/browser/forgejo-connection-lifecycle-confirmation.js",
    url: new URL(
      "./browser/forgejo-connection-lifecycle-confirmation.js",
      import.meta.url,
    ),
  },
  {
    route: "/assets/forgejo-connection.js",
    sourcePath: "src/browser/forgejo-connection.js",
    url: new URL("./browser/forgejo-connection.js", import.meta.url),
  },
  {
    route: "/assets/repository.js",
    sourcePath: "src/browser/repository.js",
    url: new URL("./browser/repository.js", import.meta.url),
  },
  {
    route: "/assets/repository-delete.js",
    sourcePath: "src/browser/repository-delete.js",
    url: new URL("./browser/repository-delete.js", import.meta.url),
  },
  {
    route: "/assets/repository-guidance.js",
    sourcePath: "src/browser/repository-guidance.js",
    url: new URL("./browser/repository-guidance.js", import.meta.url),
  },
  {
    route: "/assets/review-metadata.js",
    sourcePath: "src/browser/review-metadata.js",
    url: new URL("./browser/review-metadata.js", import.meta.url),
  },
  {
    route: "/assets/review-create.js",
    sourcePath: "src/browser/review-create.js",
    url: new URL("./browser/review-create.js", import.meta.url),
  },
  {
    route: "/assets/review-criteria.js",
    sourcePath: "src/browser/review-criteria.js",
    url: new URL("./browser/review-criteria.js", import.meta.url),
  },
  {
    route: "/assets/review-version-contract.js",
    sourcePath: "src/browser/review-version-contract.js",
    url: new URL("./browser/review-version-contract.js", import.meta.url),
  },
  {
    route: "/assets/review-version.js",
    sourcePath: "src/browser/review-version.js",
    url: new URL("./browser/review-version.js", import.meta.url),
  },
  {
    route: "/assets/review-reactivation.js",
    sourcePath: "src/browser/review-reactivation.js",
    url: new URL("./browser/review-reactivation.js", import.meta.url),
  },
  {
    route: "/assets/review-archival.js",
    sourcePath: "src/browser/review-archival.js",
    url: new URL("./browser/review-archival.js", import.meta.url),
  },
  {
    route: "/assets/review-delete.js",
    sourcePath: "src/browser/review-delete.js",
    url: new URL("./browser/review-delete.js", import.meta.url),
  },
  {
    route: "/assets/review-assignment.js",
    sourcePath: "src/browser/review-assignment.js",
    url: new URL("./browser/review-assignment.js", import.meta.url),
  },
];

export const BROWSER_ASSET_SOURCE_PATHS = browserAssets.map(
  ({ sourcePath }) => sourcePath,
);

const assetPaths = new Map(browserAssets.map(({ route, url }) => [route, url]));

export class BrowserAssetError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "BrowserAssetError";
    this.code = code;
  }
}

/** @param {string} path */
export function readBrowserAsset(path) {
  const assetPath = assetPaths.get(path);
  if (!assetPath) {
    throw new BrowserAssetError(
      "browser_asset_not_found",
      "Browser asset was not found",
    );
  }
  try {
    return readFileSync(assetPath, "utf8");
  } catch (cause) {
    throw new BrowserAssetError(
      "browser_asset_unavailable",
      "Browser asset is unavailable",
      { cause },
    );
  }
}
