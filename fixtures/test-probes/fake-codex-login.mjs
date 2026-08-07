if (
  process.argv.length !== 4 ||
  process.argv[2] !== "login" ||
  process.argv[3] !== "status"
) {
  throw new Error("fake_codex_login_arguments_invalid");
}

process.stderr.write("fake Codex is not authenticated\n");
process.exitCode = 1;
