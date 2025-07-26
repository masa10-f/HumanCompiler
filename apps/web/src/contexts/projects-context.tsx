'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

type ProjectsContextType = UseProjectsReturn;

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  const fetchProjects = useCallback(async () => {
    // Prevent multiple simultaneous fetches
    if (loading && hasInitialized) return;
    
    try {
      setLoading(true);
      setError(null);
      console.log('[ProjectsContext] Fetching projects...');
      
      const data = await projectsApi.getAll();
      console.log('[ProjectsContext] Fetched projects:', data.length);
      setProjects(data);
      setHasInitialized(true);
    } catch (err) {
      console.error('[ProjectsContext] Failed to fetch projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [loading, hasInitialized]);

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
    if (!hasInitialized) {
      fetchProjects();
    }
  }, [hasInitialized, fetchProjects]);

  const value: ProjectsContextType = {
    projects,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  };

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (context === undefined) {
    throw new Error('useProjects must be used within a ProjectsProvider');
  }
  return context;
}