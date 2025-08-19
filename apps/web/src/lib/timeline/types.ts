export interface TimelineGoal {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  estimate_hours: number
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  dependencies: string[] // Goal IDs that this goal depends on
  tasks: TimelineTask[]
}

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

export interface TimelineProject {
  id: string
  title: string
  description: string | null
  weekly_work_hours: number
  created_at: string
  updated_at: string
}

export interface TimelineData {
  project: TimelineProject
  timeline: {
    start_date: string
    end_date: string
    time_unit: string
  }
  goals: TimelineGoal[]
}

// Layout calculation results
export interface LayoutGoal {
  id: string
  title: string
  row: number // Y position (row index)
  x0: number // Start X position in pixels
  x1: number // End X position in pixels
  progress: number // Overall progress (0-1)
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  segments: LayoutTaskSegment[] // Task segments within the goal bar
  originalGoal: TimelineGoal
}

export interface LayoutTaskSegment {
  id: string
  task_id: string
  title: string
  x0: number // Start X position within goal bar
  x1: number // End X position within goal bar
  progress: number // Task progress (0-1)
  progress_percentage: number // Task progress (0-100)
  status_color: string
  originalTask: TimelineTask
}

export interface LayoutArrow {
  id: string
  from_goal_id: string
  to_goal_id: string
  path: { x: number; y: number }[] // Polyline points for arrow path
  is_valid: boolean // False if circular dependency detected
}

export interface LayoutModel {
  goals: LayoutGoal[]
  arrows: LayoutArrow[]
  timeline: {
    start_date: string
    end_date: string
    total_days: number
    pixels_per_day: number
  }
  dimensions: {
    width: number
    height: number
    row_height: number
    goal_bar_height: number
    padding: {
      top: number
      right: number
      bottom: number
      left: number
    }
  }
}

export interface TimelineConfig {
  canvas_width: number
  canvas_height: number
  row_height: number
  goal_bar_height: number
  padding: {
    top: number
    right: number
    bottom: number
    left: number
  }
  colors: {
    goal_background: string
    goal_progress: string
    arrow_stroke: string
    arrow_invalid: string
    grid_line: string
    text_primary: string
    text_secondary: string
  }
  arrow: {
    stroke_width: number
    marker_size: number
    horizontal_offset: number
  }
}

export interface DependencyGraph {
  nodes: string[] // Goal IDs
  edges: Array<{ from: string; to: string }>
  has_cycle: boolean
  topological_order: string[]
}

export interface TimelineFilters {
  start_date?: string
  end_date?: string
  time_unit: 'day' | 'week' | 'month'
  show_dependencies?: boolean
  show_task_segments?: boolean
}
