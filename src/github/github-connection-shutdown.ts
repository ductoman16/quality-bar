export function stopFor(
  polling: { destroy: () => unknown },
  publications: { destroy: () => unknown },
) {
  return (
    pending: { clear: () => unknown },
    callbackFailures: { destroy: () => unknown },
    cipher: { destroy: () => unknown },
  ) => {
    const stopPolling = () =>
      [polling, publications].forEach((service) => service.destroy());
    return {
      stopPolling,
      destroy() {
        stopPolling();
        pending.clear();
        callbackFailures.destroy();
        cipher.destroy();
      },
    };
  };
}
