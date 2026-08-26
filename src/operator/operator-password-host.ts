import { openDurableCore } from "../durable/durable-core.ts";
import { verifyInstallationKey } from "../installation-configuration.ts";

function attachCleanupFailures(
  primaryFailure: Error,
  cleanupFailures: unknown[],
) {
  if (cleanupFailures.length === 0) {
    return;
  }
  primaryFailure.cause = new AggregateError(
    [
      ...(primaryFailure.cause === undefined ? [] : [primaryFailure.cause]),
      ...cleanupFailures,
    ],
    "Operator password host mutation and cleanup both failed",
  );
}

function throwExactly(failure: unknown) {
  throw failure;
}

export async function runOperatorPasswordHostMutation<Result>({
  databasePath,
  loadInstallation,
  mutate,
  onMutationCommitted,
  readPassword,
  validateInstallation,
  validateSources,
}: {
  databasePath: string;
  loadInstallation: () => {
    freeSpaceReserveBytes: number;
    masterKey: Buffer;
  };
  mutate: (
    durableCore: ReturnType<typeof openDurableCore>,
    password: string,
  ) => Result;
  onMutationCommitted?: () => void;
  readPassword: () => string | Promise<string>;
  validateInstallation: (options: { reserveBytes: number }) => {
    releaseInstallationLock?: () => void;
  };
  validateSources: () => void;
}): Promise<Result> {
  validateSources();
  const installation = loadInstallation();
  let durableCore;
  let releaseInstallationLock;
  let mutationFailed = false;
  let primaryFailure: unknown;
  let result: Result | undefined;

  try {
    ({ releaseInstallationLock } = validateInstallation({
      reserveBytes: installation.freeSpaceReserveBytes,
    }));
    durableCore = openDurableCore(databasePath);
    verifyInstallationKey(durableCore, installation.masterKey);
    result = mutate(durableCore, await readPassword());
    onMutationCommitted?.();
  } catch (error) {
    mutationFailed = true;
    primaryFailure = error;
  }

  const cleanupFailures: unknown[] = [];
  try {
    durableCore?.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    installation.masterKey.fill(0);
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    releaseInstallationLock?.();
  } catch (error) {
    cleanupFailures.push(error);
  }

  if (mutationFailed) {
    if (primaryFailure instanceof Error) {
      attachCleanupFailures(primaryFailure, cleanupFailures);
    }
    throwExactly(primaryFailure);
  }
  if (cleanupFailures.length > 0) {
    const [cleanupFailure, ...additionalCleanupFailures] = cleanupFailures;
    if (cleanupFailure instanceof Error) {
      attachCleanupFailures(cleanupFailure, additionalCleanupFailures);
    }
    throwExactly(cleanupFailure);
  }
  return result as Result;
}
