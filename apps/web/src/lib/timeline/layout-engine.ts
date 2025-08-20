import { differenceInDays } from 'date-fns'
import type {
  TimelineData,
  TimelineGoal,
  LayoutModel,
  LayoutGoal,
  LayoutTaskSegment,
  LayoutArrow,
  TimelineConfig,
  DependencyGraph
} from './types'
import {
  analyzeDependencies,
  calculateGoalProgress,
  parseOptionalDate,
  dateToPixels,
  generateArrowPath,
  clamp,
  calculateDependencyBasedStartTimes,
  hoursOffsetToDate
} from './utils'

export class TimelineLayoutEngine {
  private config: TimelineConfig

  constructor(config: Partial<TimelineConfig> = {}) {
    this.config = {
      canvas_width: 1200,
      canvas_height: 800,
      row_height: 80,
      goal_bar_height: 40,
      padding: {
        top: 40,
        right: 60,
        bottom: 40,
        left: 200
      },
      colors: {
        goal_background: '#f1f5f9',
        goal_progress: '#3b82f6',
        arrow_stroke: '#6b7280',
        arrow_invalid: '#ef4444',
        grid_line: '#e2e8f0',
        text_primary: '#1f2937',
        text_secondary: '#6b7280'
      },
      arrow: {
        stroke_width: 2,
        marker_size: 8,
        horizontal_offset: 20
      },
      ...config
    }
  }

  /**
   * Main layout computation function
   */
  public computeLayout(data: TimelineData): LayoutModel {
    // Analyze dependencies and get topological order
    const dependencyGraph = analyzeDependencies(data.goals)

    // Calculate timeline bounds considering dependencies
    const fallbackStart = parseOptionalDate(data.timeline.start_date) || undefined
    const fallbackEnd = parseOptionalDate(data.timeline.end_date) || undefined

    const boundsResult = this.calculateTimelineBoundsWithDependencies(
      data.goals,
      data.project.weekly_work_hours,
      dependencyGraph,
      fallbackStart,
      fallbackEnd
    )

    const totalDays = Math.max(1, differenceInDays(boundsResult.bounds.end_date, boundsResult.bounds.start_date))
    const pixelsPerDay = (this.config.canvas_width - this.config.padding.left - this.config.padding.right) / totalDays

    // Sort goals by topological order for proper dependency display
    const sortedGoals = this.sortGoalsByTopology(data.goals, dependencyGraph)

    // Calculate goal layout positions with dependency-based scheduling
    const layoutGoals = this.calculateGoalPositions(
      sortedGoals,
      boundsResult.bounds,
      totalDays,
      data.project.weekly_work_hours,
      dependencyGraph,
      boundsResult.dependencyStartTimes
    )

    // Calculate dependency arrows
    const layoutArrows = this.calculateDependencyArrows(
      layoutGoals,
      dependencyGraph
    )

    // Calculate canvas dimensions based on content
    const canvasHeight = Math.max(
      this.config.canvas_height,
      layoutGoals.length * this.config.row_height + this.config.padding.top + this.config.padding.bottom
    )

    return {
      goals: layoutGoals,
      arrows: layoutArrows,
      timeline: {
        start_date: boundsResult.bounds.start_date.toISOString(),
        end_date: boundsResult.bounds.end_date.toISOString(),
        total_days: totalDays,
        pixels_per_day: pixelsPerDay
      },
      dimensions: {
        width: this.config.canvas_width,
        height: canvasHeight,
        row_height: this.config.row_height,
        goal_bar_height: this.config.goal_bar_height,
        padding: this.config.padding
      }
    }
  }

  /**
   * Calculate timeline bounds considering dependency-based scheduling
   */
  private calculateTimelineBoundsWithDependencies(
    goals: TimelineGoal[],
    weeklyWorkHours: number,
    dependencyGraph: DependencyGraph,
    fallbackStartDate?: Date,
    fallbackEndDate?: Date
  ): { bounds: { start_date: Date; end_date: Date }; dependencyStartTimes: Map<string, number> } {
    // Calculate dependency-based start times first
    const dependencyStartTimes = calculateDependencyBasedStartTimes(goals, dependencyGraph)

    // Find the earliest created date as the project start
    const createdDates = goals
      .map(g => parseOptionalDate(g.created_at))
      .filter((date): date is Date => date !== null)

    const projectStart = fallbackStartDate ||
                        (createdDates.length > 0 ? new Date(Math.min(...createdDates.map(d => d.getTime()))) : new Date())

    let minStart = projectStart
    let maxEnd = fallbackEndDate || projectStart

    goals.forEach(goal => {
      // Calculate actual start date considering dependencies
      const dependencyStartTimeHours = dependencyStartTimes.get(goal.id) || 0
      const dependencyBasedStart = hoursOffsetToDate(projectStart, dependencyStartTimeHours, weeklyWorkHours)

      const actualStartDate = parseOptionalDate(goal.start_date) || dependencyBasedStart
      const explicitEndDate = parseOptionalDate(goal.end_date)

      // Update min start time
      if (actualStartDate < minStart) {
        minStart = actualStartDate
      }

      // Calculate or use explicit end date
      const actualEndDate = explicitEndDate ||
                           this.calculateGoalEndDate(actualStartDate, goal.estimate_hours, weeklyWorkHours)

      // Update max end time
      if (actualEndDate > maxEnd) {
        maxEnd = actualEndDate
      }
    })

    return {
      bounds: { start_date: minStart, end_date: maxEnd },
      dependencyStartTimes
    }
  }

  /**
   * Sort goals by topological order to respect dependencies
   */
  private sortGoalsByTopology(goals: TimelineGoal[], graph: DependencyGraph): TimelineGoal[] {
    const goalMap = new Map(goals.map(g => [g.id, g]))

    return graph.topological_order
      .map(id => goalMap.get(id))
      .filter((goal): goal is TimelineGoal => goal !== undefined)
      .concat(
        // Add any goals not in the dependency graph
        goals.filter(g => !graph.topological_order.includes(g.id))
      )
  }

  /**
   * Calculate layout positions for goals with dependency-based scheduling
   */
  private calculateGoalPositions(
    goals: TimelineGoal[],
    bounds: { start_date: Date; end_date: Date },
    totalDays: number,
    weeklyWorkHours: number,
    dependencyGraph: DependencyGraph,
    dependencyStartTimes: Map<string, number>
  ): LayoutGoal[] {

    return goals.map((goal, index) => {
      // Calculate dependency-based start time relative to timeline start
      const dependencyStartTimeHours = dependencyStartTimes.get(goal.id) || 0
      const dependencyBasedStart = hoursOffsetToDate(bounds.start_date, dependencyStartTimeHours, weeklyWorkHours)

      // Use explicit start date if available, otherwise use dependency-based calculation
      const goalStart = parseOptionalDate(goal.start_date) || dependencyBasedStart

      const goalEnd = parseOptionalDate(goal.end_date) ||
                     this.calculateGoalEndDate(goalStart, goal.estimate_hours, weeklyWorkHours)

      const x0 = dateToPixels(goalStart, bounds.start_date, totalDays, this.config.canvas_width, this.config.padding)
      const x1 = dateToPixels(goalEnd, bounds.start_date, totalDays, this.config.canvas_width, this.config.padding)

      // Calculate task segments within the goal
      const segments = this.calculateTaskSegments(goal, x0, x1)

      return {
        id: goal.id,
        title: goal.title,
        row: index,
        x0: Math.round(x0),
        x1: Math.round(x1),
        progress: calculateGoalProgress(goal),
        status: goal.status,
        segments,
        originalGoal: goal
      }
    })
  }

  /**
   * Calculate task segments within a goal bar
   */
  private calculateTaskSegments(goal: TimelineGoal, goalX0: number, goalX1: number): LayoutTaskSegment[] {
    if (goal.tasks.length === 0) return []

    const goalWidth = goalX1 - goalX0
    const totalWeight = goal.tasks.reduce((sum, task) => sum + task.estimate_hours, 0)

    if (totalWeight === 0 || goalWidth <= 0) return []

    let currentX = goalX0

    return goal.tasks.map(task => {
      const taskWidth = (task.estimate_hours / totalWeight) * goalWidth
      const x0 = currentX
      const x1 = currentX + taskWidth

      currentX = x1

      return {
        id: `${goal.id}-${task.id}`,
        task_id: task.id,
        title: task.title,
        x0: Math.round(x0),
        x1: Math.round(x1),
        progress: clamp(task.progress_percentage / 100, 0, 1),
        progress_percentage: task.progress_percentage,
        status_color: task.status_color,
        originalTask: task
      }
    })
  }

  /**
   * Calculate dependency arrow paths
   */
  private calculateDependencyArrows(
    layoutGoals: LayoutGoal[],
    dependencyGraph: DependencyGraph
  ): LayoutArrow[] {
    const goalPositions = new Map(layoutGoals.map(g => [g.id, g]))
    const arrows: LayoutArrow[] = []

    dependencyGraph.edges.forEach((edge, index) => {
      const fromGoal = goalPositions.get(edge.from)
      const toGoal = goalPositions.get(edge.to)

      if (!fromGoal || !toGoal) return

      // Calculate arrow positions
      const fromY = this.config.padding.top + fromGoal.row * this.config.row_height + this.config.goal_bar_height / 2
      const toY = this.config.padding.top + toGoal.row * this.config.row_height + this.config.goal_bar_height / 2

      // Add horizontal offset for multiple arrows to avoid overlap
      const horizontalOffset = this.config.arrow.horizontal_offset + (index % 3) * 10

      const path = generateArrowPath(
        fromGoal.x1,
        fromY,
        toGoal.x0,
        toY,
        horizontalOffset
      )

      arrows.push({
        id: `${edge.from}-${edge.to}`,
        from_goal_id: edge.from,
        to_goal_id: edge.to,
        path,
        is_valid: !dependencyGraph.has_cycle
      })
    })

    return arrows
  }

  /**
   * Calculate goal end date based on estimate and weekly work hours
   */
  private calculateGoalEndDate(startDate: Date, estimateHours: number, weeklyWorkHours: number): Date {
    const durationWeeks = estimateHours / weeklyWorkHours
    const daysOffset = durationWeeks * 7
    const endDate = new Date(startDate)
    endDate.setTime(endDate.getTime() + daysOffset * 24 * 60 * 60 * 1000)
    return endDate
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<TimelineConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  /**
   * Get current configuration
   */
  public getConfig(): TimelineConfig {
    return { ...this.config }
  }
}

/**
 * Create a default timeline layout engine instance
 */
export function createTimelineLayoutEngine(config?: Partial<TimelineConfig>): TimelineLayoutEngine {
  return new TimelineLayoutEngine(config)
}

/**
 * Compute layout with default configuration
 */
export function computeTimelineLayout(
  data: TimelineData,
  config?: Partial<TimelineConfig>
): LayoutModel {
  const engine = createTimelineLayoutEngine(config)
  return engine.computeLayout(data)
}
