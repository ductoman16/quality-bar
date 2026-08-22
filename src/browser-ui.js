import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
const CONFIGURATION = "__QUALITY_BAR_CONFIGURATION__";

if (!template.includes(CONFIGURATION)) {
  throw new Error("browser_build_invalid");
}

/** @param {Record<string, unknown>} configuration @param {"dark" | "light" | undefined} theme */
export function browserDocument(configuration, theme) {
  const json = JSON.stringify(configuration).replaceAll("<", "\\u003c");
  const themeAttribute = theme ? ` data-theme="${theme}"` : "";
  return template
    .replace('<html lang="en">', `<html lang="en"${themeAttribute}>`)
    .replace(CONFIGURATION, json);
}
