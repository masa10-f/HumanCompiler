/**
 * Read and remove the task deep-link parameter so Runner handles it once.
 *
 * Other query parameters and the hash are preserved.
 */
export function consumeRunnerTaskId(): string | null {
  const url = new URL(window.location.href);
  const taskId = url.searchParams.get("taskId");
  if (!taskId) return null;

  url.searchParams.delete("taskId");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return taskId;
}
