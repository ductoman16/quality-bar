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
