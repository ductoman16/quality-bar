export function createIoDutyTimer(
  schedule: (() => unknown) & { background: () => boolean },
  {
    clearTimer = (timer) => clearTimeout(timer as NodeJS.Timeout),
    retryDelay,
    setTimer = setTimeout,
  }: {
    clearTimer?: (timer: unknown) => void;
    retryDelay: number;
    setTimer?: (callback: () => void, delay: number) => any;
  },
) {
  let enabled = false;
  let generation = 0;
  let timer: any = null;
  function scheduleNext(delay: number, expectedGeneration: number) {
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
    schedule(delay: number) {
      if (enabled) {
        scheduleNext(delay, generation);
      }
    },
    start(delay: number) {
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
