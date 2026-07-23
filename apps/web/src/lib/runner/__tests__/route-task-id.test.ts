import { consumeRunnerTaskId } from "../route-task-id";

describe("consumeRunnerTaskId", () => {
  it("consumes the task id once and preserves the rest of the URL", () => {
    window.history.replaceState(
      {},
      "",
      "/runner?taskId=task-1&source=workspace#focus",
    );

    expect(consumeRunnerTaskId()).toBe("task-1");
    expect(window.location.pathname).toBe("/runner");
    expect(window.location.search).toBe("?source=workspace");
    expect(window.location.hash).toBe("#focus");
    expect(consumeRunnerTaskId()).toBeNull();
  });

  it("does not rewrite the URL when no task id is present", () => {
    window.history.replaceState({}, "", "/runner?source=workspace");
    const replaceState = jest.spyOn(window.history, "replaceState");

    expect(consumeRunnerTaskId()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();

    replaceState.mockRestore();
  });
});
