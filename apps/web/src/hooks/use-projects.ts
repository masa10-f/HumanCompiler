import { useState, useEffect, useCallback } from 'react';
import { projectsApi } from '@/lib/api';
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project';
import { log } from '@/lib/logger';

export interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  error: string | null;
  createProject: (data: ProjectCreate) => Promise<void>;
  updateProject: (id: string, data: ProjectUpdate) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      log.component('useProjects', 'fetching', { action: 'fetch_projects' });

      const data = await projectsApi.getAll();
      log.component('useProjects', 'fetch_success', { count: data.length });
      setProjects(data);
    } catch (err) {
      log.error('Failed to fetch projects', err, { component: 'useProjects', action: 'fetch_error' });
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (data: ProjectCreate) => {
    try {
      setError(null);
      log.userAction('create_project', data, { component: 'useProjects' });

      const newProject = await projectsApi.create(data);
      log.component('useProjects', 'create_success', { projectId: newProject.id });

      setProjects(prev => [...prev, newProject]);
    } catch (err) {
      log.error('Failed to create project', err, { component: 'useProjects', action: 'create_error' });
      setError(err instanceof Error ? err.message : 'Failed to create project');
      throw err;
    }
  }, []);

  const updateProject = useCallback(async (id: string, data: ProjectUpdate) => {
    try {
      setError(null);
      const updatedProject = await projectsApi.update(id, data);
      setProjects(prev => prev.map(project =>
        project.id === id ? updatedProject : project
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project');
      throw err;
    }
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    try {
      setError(null);
      await projectsApi.delete(id);
      setProjects(prev => prev.filter(project => project.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
      throw err;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadProjects = async () => {
      if (!mounted) return;
      log.component('useProjects', 'mounted');
      await fetchProjects();
    };

    loadProjects();

    return () => {
      mounted = false;
    };
  }, [fetchProjects]);

  return {
    projects,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  };
}
