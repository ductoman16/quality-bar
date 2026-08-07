/**
 * @param {{destroy: () => unknown}} polling
 * @param {{destroy: () => unknown}} publications
 */
export function stopFor(polling, publications) {
  /**
   * @param {{clear: () => unknown}} pending
   * @param {{destroy: () => unknown}} callbackFailures
   * @param {{destroy: () => unknown}} cipher
   */
  return (pending, callbackFailures, cipher) => {
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
