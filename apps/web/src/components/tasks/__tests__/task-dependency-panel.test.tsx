import { render, screen } from "@testing-library/react";

import { TaskDependencyPanel } from "../task-dependency-panel";
import type { Task } from "@/types/task";

const task: Task = {
  id: "task-1",
  title: "Deep linked task",
  description: null,
  estimate_hours: 1,
  due_date: null,
  status: "pending",
  priority: 2,
  goal_id: "goal-1",
  created_at: "2026-07-23T00:00:00Z",
  updated_at: "2026-07-23T00:00:00Z",
  dependencies: [],
};

jest.mock("@/hooks/use-tasks-query", () => ({
  useTask: () => ({ data: task, isLoading: false }),
  useTaskDependencyContext: () => ({
    data: { prerequisites: [], dependents: [] },
    isLoading: false,
  }),
}));

jest.mock("@/hooks/use-goals-query", () => ({
  useGoal: () => ({
    data: { id: "goal-1", project_id: "project-1" },
    isLoading: false,
  }),
}));

jest.mock("@/components/tasks/task-edit-dialog", () => ({
  TaskEditDialog: ({ children }: { children: React.ReactNode }) => children,
}));

describe("TaskDependencyPanel", () => {
  it("links directly to the selected task detail page", () => {
    render(
      <TaskDependencyPanel
        taskId={task.id}
        availableTasks={[task]}
        onClose={jest.fn()}
        onSelectTask={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "タスク詳細ページを開く" }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/goals/goal-1/tasks/task-1",
    );
  });
});
