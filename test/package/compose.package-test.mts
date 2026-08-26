import { test } from "node:test";

import { assertComposeConfiguration } from "../../scripts/package-proof/compose-configuration.mts";
import { createPackageFixture } from "../../scripts/package-proof/package-fixture.mts";
import { proveComposeService } from "../../scripts/package-proof/prove-compose-service.mts";

test("Compose boots with one strict configuration source and external installation master key", async () => {
  const fixture = await createPackageFixture();
  let primaryFailure;

  try {
    const configuration = assertComposeConfiguration(fixture);
    proveComposeService({ configuration, fixture });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    fixture.cleanup(primaryFailure);
  }
});
