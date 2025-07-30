// Project type definitions for frontend
export interface Project {
  id: string;
  title: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  title: string;
  description?: string;
}

export interface ProjectUpdate {
  title?: string;
  description?: string;
}

export interface ProjectResponse {
  id: string;
  title: string;
  description: string | null;
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
