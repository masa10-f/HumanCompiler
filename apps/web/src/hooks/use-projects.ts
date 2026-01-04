import { useState, useEffect, useCallback } from 'react';
import { projectsApi } from '@/lib/api';
import { log } from '@/lib/logger';
import { handleHookError } from './utils/hook-error-handler';
import type { Project, ProjectCreate, ProjectUpdate } from '@/types/project';

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
      log.component('useProjects', 'fetching');

      const data = await projectsApi.getAll();
      log.component('useProjects', 'fetch_success', { count: data.length });
      setProjects(data);
    } catch (err) {
      const errorMessage = handleHookError(err, 'useProjects', 'fetch projects');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (data: ProjectCreate) => {
    try {
      setError(null);
      log.userAction('create_project', data, { component: 'useProjects' });

      const newProject = await projectsApi.create(data);
      log.component('useProjects', 'create_success', {
        projectId: newProject.id,
      });

      setProjects((prev) => [...prev, newProject]);
    } catch (err) {
      const errorMessage = handleHookError(
        err,
        'useProjects',
        'create project'
      );
      setError(errorMessage);
      throw err;
    }
  }, []);

  const updateProject = useCallback(
    async (id: string, data: ProjectUpdate) => {
      try {
        setError(null);
        log.component('useProjects', 'updating', { projectId: id, ...data });

        const updatedProject = await projectsApi.update(id, data);
        log.component('useProjects', 'update_success', { projectId: id });

        setProjects((prev) =>
          prev.map((project) => (project.id === id ? updatedProject : project))
        );
      } catch (err) {
        const errorMessage = handleHookError(
          err,
          'useProjects',
          'update project',
          { projectId: id }
        );
        setError(errorMessage);
        throw err;
      }
    },
    []
  );

  const deleteProject = useCallback(async (id: string) => {
    try {
      setError(null);
      log.component('useProjects', 'deleting', { projectId: id });

      await projectsApi.delete(id);
      log.component('useProjects', 'delete_success', { projectId: id });

      setProjects((prev) => prev.filter((project) => project.id !== id));
    } catch (err) {
      const errorMessage = handleHookError(
        err,
        'useProjects',
        'delete project',
        { projectId: id }
      );
      setError(errorMessage);
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
