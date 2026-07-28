import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** @param {string} directory @param {string} name @param {boolean} populated */
export function createBareRepository(directory, name, populated) {
  const repository = join(directory, `${name}.git`);
  if (populated) {
    const source = join(directory, `${name}-source`);
    execFileSync("git", ["init", "--initial-branch=main", source], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", source, "config", "user.name", "Quality Bar"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", source, "config", "user.email", "quality-bar@example.invalid"],
      { stdio: "ignore" },
    );
    execFileSync(
      "git",
      ["-C", source, "commit", "--allow-empty", "-m", "fact"],
      { stdio: "ignore" },
    );
    execFileSync("git", ["clone", "--bare", source, repository], {
      stdio: "ignore",
    });
  } else {
    execFileSync("git", ["init", "--bare", repository], { stdio: "ignore" });
  }
  execFileSync("git", ["--git-dir", repository, "update-server-info"], {
    stdio: "ignore",
  });
}
