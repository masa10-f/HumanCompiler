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

export function getGoalProjectIds<
  T extends Pick<Project, 'id' | 'status'>
>(projects: T[], selectedProjectId = ''): string[] {
  const projectIds = getOpenProjects(projects).map((project) => project.id);

  if (selectedProjectId && !projectIds.includes(selectedProjectId)) {
    projectIds.push(selectedProjectId);
  }

  return projectIds;
}
