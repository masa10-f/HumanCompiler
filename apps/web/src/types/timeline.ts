export interface TimelineTask {
  id: string
  goal_id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  estimate_hours: number
  due_date: string | null
  created_at: string
  updated_at: string
  progress_percentage: number
  status_color: string
  actual_hours: number
  logs_count: number
}

export interface TimelineGoal {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  estimate_hours: number
  start_date: string | null
  end_date: string | null
  dependencies: string[]
  created_at: string
  updated_at: string
  tasks: TimelineTask[]
}

export interface ProjectTimelineData {
  project: {
    id: string
    title: string
    description: string | null
    weekly_work_hours: number
    created_at: string
    updated_at: string
  }
  timeline: {
    start_date: string
    end_date: string
    time_unit: string
  }
  goals: TimelineGoal[]
}

export interface ProjectStatistics {
  total_goals: number
  completed_goals: number
  in_progress_goals: number
  total_tasks: number
  completed_tasks: number
  in_progress_tasks: number
  goals_completion_rate: number
  tasks_completion_rate: number
}

export interface TimelineProject {
  id: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  statistics: ProjectStatistics
}

export interface TimelineOverviewData {
  timeline: {
    start_date: string
    end_date: string
  }
  projects: TimelineProject[]
}

export interface TimelineFilters {
  start_date?: string
  end_date?: string
  time_unit: 'day' | 'week' | 'month'
  show_dependencies?: boolean
  show_task_segments?: boolean
}
