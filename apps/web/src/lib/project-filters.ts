import type { Project } from '@/types/project';

export function isSelectableProject(project: Pick<Project, 'status'>): boolean {
  return project.status === 'in_progress';
}

export function getSelectableProjects<T extends Pick<Project, 'status'>>(
  projects: T[]
): T[] {
  return projects.filter(isSelectableProject);
}
