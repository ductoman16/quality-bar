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
  let generation = 0;
  /** @type {any} */
  let timer = null;
  /** @param {number} delay @param {number} expectedGeneration */
  function scheduleNext(delay, expectedGeneration) {
    if (!enabled || expectedGeneration !== generation || timer !== null) {
      return;
    }
    const nextTimer = setTimer(() => {
      if (
        !enabled ||
        expectedGeneration !== generation ||
        timer !== nextTimer
      ) {
        return;
      }
      timer = null;
      if (!schedule.background()) {
        scheduleNext(retryDelay, expectedGeneration);
      }
    }, delay);
    timer = nextTimer;
    nextTimer.unref();
  }
  return {
    /** @param {number} delay */
    schedule(delay) {
      if (enabled) {
        scheduleNext(delay, generation);
      }
    },
    /** @param {number} delay */
    start(delay) {
      if (enabled) {
        return;
      }
      enabled = true;
      generation += 1;
      scheduleNext(delay, generation);
    },
    stop() {
      enabled = false;
      generation += 1;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
