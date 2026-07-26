import { validateOpenApi31Document } from "./openapi-conformance.mjs";
import { canonicalOpenApiDocument } from "../src/canonical-api.js";

try {
  const facts = await validateOpenApi31Document(canonicalOpenApiDocument());
  process.stdout.write(
    `openapi_structure: PASS (${facts.documents} document, ${facts.operations} operations, ${facts.responseStatuses} response statuses; OpenAPI ${facts.version})\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
