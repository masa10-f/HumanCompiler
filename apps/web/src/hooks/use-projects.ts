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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Add timeout to prevent indefinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        const data = await projectsApi.getAll();
        clearTimeout(timeoutId);
        setProjects(data);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          throw new Error('タイムアウト: サーバーからの応答がありません');
        }
        throw fetchErr;
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (data: ProjectCreate) => {
    try {
      setError(null);
      const newProject = await projectsApi.create(data);
      setProjects(prev => [...prev, newProject]);
    } catch (err) {
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
    console.log('[useProjects] Fetching projects on mount...');
    fetchProjects();
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