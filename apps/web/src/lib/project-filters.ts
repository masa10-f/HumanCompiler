import type { Project } from '@/types/project';

export function isSelectableProject(project: Pick<Project, 'status'>): boolean {
  return project.status === 'in_progress';
}

export function getSelectableProjects<T extends Pick<Project, 'status'>>(
  projects: T[]
): T[] {
  return projects.filter(isSelectableProject);
}

export function isOpenProject(project: Pick<Project, 'status'>): boolean {
  return project.status === 'pending' || project.status === 'in_progress';
}

export function getOpenProjects<T extends Pick<Project, 'status'>>(
  projects: T[]
): T[] {
  return projects.filter(isOpenProject);
}

export const MAX_GOAL_PROJECT_QUERIES = 100;

/**
 * Bounds goal-query fan-out and keeps a selected archived project available
 * for inspecting its existing tasks.
 */
export function getGoalProjectIds<
  T extends Pick<Project, 'id' | 'status'>
>(
  projects: T[],
  selectedProjectId = '',
  limit = MAX_GOAL_PROJECT_QUERIES
): string[] {
  const projectIds = getOpenProjects(projects)
    .slice(0, limit)
    .map((project) => project.id);

  if (selectedProjectId && !projectIds.includes(selectedProjectId)) {
    if (projectIds.length >= limit && limit > 0) {
      projectIds[projectIds.length - 1] = selectedProjectId;
    } else if (limit > 0) {
      projectIds.push(selectedProjectId);
    }
  }

  return projectIds;
}
