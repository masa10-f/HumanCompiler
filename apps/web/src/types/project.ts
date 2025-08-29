// Project status enum
export type ProjectStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

// Project type definitions for frontend
export interface Project {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  title: string;
  description?: string;
  status: ProjectStatus;
}

export interface ProjectUpdate {
  title?: string;
  description?: string;
  status?: ProjectStatus;
}

export interface ProjectResponse {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectsApiResponse {
  data: Project[];
  total: number;
}

export interface ProjectFormData {
  title: string;
  description: string;
}
