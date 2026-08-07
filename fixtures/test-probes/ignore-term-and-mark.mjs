import { writeFileSync } from "node:fs";

const marker = process.argv[2];
if (typeof marker !== "string" || marker.length === 0) {
  throw new TypeError("marker path is required");
}
process.on("SIGTERM", () => {});
writeFileSync(marker, "started", { encoding: "utf8", flag: "wx" });
setInterval(() => {}, 60_000);
