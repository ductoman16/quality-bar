/**
 * Shared control-flow used by both forge Connection lifecycle modules.
 *
 * Both forges share the same overall shape for the two lifecycle transitions
 * that they support outside of the onboarding/verification pipeline:
 *
 *   - **Retire** an existing Connection: the request body must be exactly
 *     `{lifecycle: "retired"}`; retirement is idempotent; retirement is
 *     refused while dependent Repositories are enabled or disabled; the
 *     transaction commits per-forge cleanup SQL and flips the lifecycle
 *     column to `retired`; both the credential DELETE and the lifecycle
 *     UPDATE must affect exactly one row or the operation is a conflict.
 *
 *   - **Remove** a never-used Connection: refuse if any dependent
 *     Repositories exist; run the per-forge deletion transaction.
 *
 * The specific SQL, table names, and per-forge cleanup live inside the
 * per-forge lifecycle modules. This helper carries only the shared
 * validation, existence checks, and control-flow.
 *
 * Each forge passes its own `raise(code, message)` — GitHub throws
 * `GitHubConnectionError` and Forgejo throws a plain `Error` carrying a
 * `code` property. The shared runner never constructs an error class of
 * its own; it defers to the forge's `raise` so `instanceof` invariants
 * downstream of these flows are preserved.
 */

/**
 * Validate a Connection retirement request body — both forges accept the
 * same `{lifecycle: "retired"}` payload; only the error the forge throws
 * differs.
 *
 * @param {unknown} input
 * @param {{code: string, message: string}} error
 * @param {(code: string, message: string) => never} raise
 */
export function assertRetirementRequest(input, error, raise) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.keys(input).length !== 1 ||
    /** @type {Record<string, unknown>} */ (input).lifecycle !== "retired"
  ) {
    raise(error.code, error.message);
  }
}

/**
 * Run the shared retire-Connection flow: validate body, load the singleton
 * Connection, honour retirement idempotency, refuse while dependents are
 * still enabled, delegate the transaction body to the per-forge hook, and
 * return the reader result.
 *
 * @template Connection, Reader
 * @param {{
 *   durableCore: any,
 *   input: unknown,
 *   raise: (code: string, message: string) => never,
 *   requestError: {code: string, message: string},
 *   loadConnection: (durableCore: any) => Connection | undefined,
 *   notFoundError: {code: string, message: string},
 *   isRetired: (connection: Connection) => boolean,
 *   readConnection: () => Reader,
 *   requireDependents?: (durableCore: any, connection: Connection) => void,
 *   hasActiveDependents: (durableCore: any, connection: Connection) => boolean,
 *   activeDependentsError: {code: string, message: string},
 *   runTransaction: (
 *     transaction: {run: (sql: string, ...parameters: import("node:sqlite").SQLInputValue[]) => import("node:sqlite").StatementResultingChanges},
 *     connection: Connection,
 *     helpers: {assertSingleChange: (changes: import("node:sqlite").StatementResultingChanges) => void, raiseConflict: () => never},
 *   ) => void,
 *   conflictError: {code: string, message: string},
 * }} dependencies
 */
export function runConnectionRetirement({
  durableCore,
  input,
  raise,
  requestError,
  loadConnection,
  notFoundError,
  isRetired,
  readConnection,
  requireDependents,
  hasActiveDependents,
  activeDependentsError,
  runTransaction,
  conflictError,
}) {
  assertRetirementRequest(input, requestError, raise);
  const connection = loadConnection(durableCore);
  if (!connection) {
    raise(notFoundError.code, notFoundError.message);
  }
  if (isRetired(/** @type {Connection} */ (connection))) {
    return readConnection();
  }
  requireDependents?.(durableCore, /** @type {Connection} */ (connection));
  if (
    hasActiveDependents(durableCore, /** @type {Connection} */ (connection))
  ) {
    raise(activeDependentsError.code, activeDependentsError.message);
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
    /** @returns {never} */
    const raiseConflict = () =>
      raise(conflictError.code, conflictError.message);
    /** @param {import("node:sqlite").StatementResultingChanges} changes */
    const assertSingleChange = (changes) => {
      if (changes.changes !== 1) {
        raiseConflict();
      }
    };
    runTransaction(transaction, /** @type {Connection} */ (connection), {
      assertSingleChange,
      raiseConflict,
    });
  });
  return readConnection();
}

/**
 * Run the shared remove-never-used-Connection flow: load the singleton
 * Connection, refuse when any dependent Repositories exist, delegate the
 * deletion transaction to the per-forge hook.
 *
 * @template Connection
 * @param {{
 *   durableCore: any,
 *   raise: (code: string, message: string) => never,
 *   loadConnection: (durableCore: any) => Connection | undefined,
 *   notFoundError: {code: string, message: string},
 *   hasAnyDependents: (durableCore: any, connection: Connection) => boolean,
 *   dependentsError: {code: string, message: string},
 *   runTransaction: (
 *     transaction: {run: (sql: string, ...parameters: import("node:sqlite").SQLInputValue[]) => import("node:sqlite").StatementResultingChanges},
 *     connection: Connection,
 *     helpers: {assertSingleChange: (changes: import("node:sqlite").StatementResultingChanges) => void, raiseConflict: () => never},
 *   ) => void,
 *   conflictError: {code: string, message: string},
 * }} dependencies
 */
export function runConnectionRemoval({
  durableCore,
  raise,
  loadConnection,
  notFoundError,
  hasAnyDependents,
  dependentsError,
  runTransaction,
  conflictError,
}) {
  const connection = loadConnection(durableCore);
  if (!connection) {
    raise(notFoundError.code, notFoundError.message);
  }
  if (hasAnyDependents(durableCore, /** @type {Connection} */ (connection))) {
    raise(dependentsError.code, dependentsError.message);
  }
  durableCore.transaction((/** @type {any} */ transaction) => {
    /** @returns {never} */
    const raiseConflict = () =>
      raise(conflictError.code, conflictError.message);
    /** @param {import("node:sqlite").StatementResultingChanges} changes */
    const assertSingleChange = (changes) => {
      if (changes.changes !== 1) {
        raiseConflict();
      }
    };
    runTransaction(transaction, /** @type {Connection} */ (connection), {
      assertSingleChange,
      raiseConflict,
    });
  });
}
