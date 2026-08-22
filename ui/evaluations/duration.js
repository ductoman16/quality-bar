/** @param {number} value */
export function formatDuration(value) {
  if (value < 1_000) {
    return `${value} ms`;
  }
  const seconds = Math.floor(value / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
