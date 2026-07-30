/**
 * @param {(() => unknown) & {background: () => boolean}} schedule
 * @param {{
 *   clearTimer?: (timer: unknown) => void,
 *   retryDelay: number,
 *   setTimer?: (callback: () => void, delay: number) => any
 * }} options
 */
export function createIoDutyTimer(
  schedule,
  {
    clearTimer = (timer) => clearTimeout(/** @type {NodeJS.Timeout} */ (timer)),
    retryDelay,
    setTimer = setTimeout,
  },
) {
  let enabled = false;
  /** @type {any} */
  let timer = null;
  /** @param {number} delay */
  function scheduleNext(delay) {
    timer = setTimer(() => {
      timer = null;
      if (!schedule.background() && enabled) {
        scheduleNext(retryDelay);
      }
    }, delay);
    timer.unref();
  }
  return {
    /** @param {number} delay */
    schedule(delay) {
      if (enabled) {
        scheduleNext(delay);
      }
    },
    /** @param {number} delay */
    start(delay) {
      if (enabled) {
        return;
      }
      enabled = true;
      scheduleNext(delay);
    },
    stop() {
      enabled = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
