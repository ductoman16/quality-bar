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
];

export const BROWSER_ASSET_SOURCE_PATHS = browserAssets.map(
  ({ sourcePath }) => sourcePath,
);

const assetPaths = new Map(browserAssets.map(({ route, url }) => [route, url]));

export class BrowserAssetError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "BrowserAssetError";
    this.code = code;
  }
}

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
