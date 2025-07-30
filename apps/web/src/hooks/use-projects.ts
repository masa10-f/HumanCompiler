import { useState, useEffect, useCallback } from 'react';
import { projectsApi } from '@/lib/api';
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
      console.log('[useProjects] Fetching projects...');

      const data = await projectsApi.getAll();
      console.log('[useProjects] Success:', data);
      setProjects(data);
    } catch (err) {
      console.error('[useProjects] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (data: ProjectCreate) => {
    try {
      setError(null);
      console.log('[useProjects] Creating project:', data);

      const newProject = await projectsApi.create(data);
      console.log('[useProjects] Created project:', newProject);

      setProjects(prev => [...prev, newProject]);
    } catch (err) {
      console.error('[useProjects] Create error:', err);
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
      console.log('[useProjects] Component mounted, fetching projects...');
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
