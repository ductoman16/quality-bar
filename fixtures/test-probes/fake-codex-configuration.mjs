const expectedNames = [
  "--ignore-user-config",
  "--model",
  "--config",
  "--config",
];
const values = process.argv.slice(2);
const names = [values[0], values[1], values[3], values[5]];
const reasoning = /^model_reasoning_effort="([^"]+)"$/.exec(values[4] ?? "");
const tier = /^service_tier="([^"]+)"$/.exec(values[6] ?? "");
if (
  values.length !== 7 ||
  names.some((name, index) => name !== expectedNames[index]) ||
  reasoning === null ||
  tier === null
) {
  throw new Error("fake_codex_configuration_arguments_invalid");
}
process.stdout.write(
  JSON.stringify({
    model: values[2],
    reasoning_effort: reasoning[1],
    service_tier: tier[1],
  }),
);
