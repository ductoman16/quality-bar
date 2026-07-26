import { readFileSync } from "node:fs";

const assetPaths = new Map([
  ["/assets/login.js", new URL("./browser/login.js", import.meta.url)],
  ["/assets/operator.js", new URL("./browser/operator.js", import.meta.url)],
]);

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
