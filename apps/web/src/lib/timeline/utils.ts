import { parseISO, differenceInDays, format } from 'date-fns'
import type { TimelineGoal, DependencyGraph } from './types'

/**
 * Safe debug logging utility for timeline operations
 */
function debugLog(message: string): void {
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_TIMELINE) {
    console.debug(`[Timeline] ${message}`)
  }
}

/**
 * Calculate project duration in weeks based on estimate hours and weekly work hours
 */
export function calculateProjectDurationWeeks(
  estimateHours: number,
  weeklyWorkHours: number
): number {
  if (weeklyWorkHours <= 0) return 1
  return estimateHours / weeklyWorkHours
}

/**
 * Calculate goal end date based on start date, estimate hours and weekly work hours
 */
export function calculateGoalEndDate(
  startDate: Date,
  estimateHours: number,
  weeklyWorkHours: number
): Date {
  const durationWeeks = calculateProjectDurationWeeks(estimateHours, weeklyWorkHours)
  const daysOffset = durationWeeks * 7
  const endDate = new Date(startDate)
  endDate.setTime(endDate.getTime() + daysOffset * 24 * 60 * 60 * 1000)
  return endDate
}

/**
 * Parse and validate date strings, with fallback handling
 */
export function parseOptionalDate(dateString: string | null): Date | null {
  if (!dateString) return null
  try {
    return parseISO(dateString)
  } catch {
    return null
  }
}

/**
 * Calculate the overall progress of a goal based on its tasks
 */
export function calculateGoalProgress(goal: TimelineGoal): number {
  if (goal.tasks.length === 0) return 0

  const totalWeight = goal.tasks.reduce((sum, task) => sum + task.estimate_hours, 0)
  if (totalWeight === 0) return 0

  const weightedProgress = goal.tasks.reduce(
    (sum, task) => sum + (task.progress_percentage / 100) * task.estimate_hours,
    0
  )

  return Math.min(weightedProgress / totalWeight, 1)
}

/**
 * Topological sort using Kahn's algorithm to detect cycles and sort dependencies
 */
export function analyzeDependencies(goals: TimelineGoal[]): DependencyGraph {
  const nodes = goals.map(g => g.id)
  const edges: Array<{ from: string; to: string }> = []

  // Build edge list from dependencies
  goals.forEach(goal => {
    goal.dependencies.forEach(depId => {
      edges.push({ from: depId, to: goal.id })
    })
  })

  // Kahn's algorithm for topological sorting
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>()

  // Initialize
  nodes.forEach(node => {
    inDegree.set(node, 0)
    adjList.set(node, [])
  })

  // Build adjacency list and calculate in-degrees
  edges.forEach(({ from, to }) => {
    // Only process if both nodes exist
    if (nodes.includes(from) && nodes.includes(to)) {
      adjList.get(from)?.push(to)
      inDegree.set(to, (inDegree.get(to) || 0) + 1)
    }
  })

  const result: string[] = []
  const queue: string[] = []

  // Find all nodes with no incoming edges
  inDegree.forEach((degree, node) => {
    if (degree === 0) {
      queue.push(node)
    }
  })

  // Process queue
  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current)

    // Remove edges from current node
    adjList.get(current)?.forEach(neighbor => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) {
        queue.push(neighbor)
      }
    })
  }

  const has_cycle = result.length !== nodes.length

  return {
    nodes,
    edges: edges.filter(({ from, to }) => nodes.includes(from) && nodes.includes(to)),
    has_cycle,
    topological_order: has_cycle ? nodes : result // If cycle detected, use original order
  }
}

/**
 * Calculate timeline bounds from goals data
 */
export function calculateTimelineBounds(
  goals: TimelineGoal[],
  weeklyWorkHours: number,
  fallbackStartDate?: Date,
  fallbackEndDate?: Date
): { start_date: Date; end_date: Date } {
  const now = new Date()
  let minStart = fallbackStartDate || now
  let maxEnd = fallbackEndDate || now

  goals.forEach(goal => {
    const startDate = parseOptionalDate(goal.start_date)
    const endDate = parseOptionalDate(goal.end_date)

    if (startDate) {
      if (startDate < minStart) minStart = startDate

      // If goal has explicit end date, use it
      if (endDate && endDate > maxEnd) {
        maxEnd = endDate
      } else {
        // Calculate end date based on estimate and weekly hours
        const calculatedEnd = calculateGoalEndDate(startDate, goal.estimate_hours, weeklyWorkHours)
        if (calculatedEnd > maxEnd) maxEnd = calculatedEnd
      }
    } else if (endDate) {
      if (endDate > maxEnd) maxEnd = endDate
    } else {
      // Use created_at as fallback for start
      const createdDate = parseOptionalDate(goal.created_at)
      if (createdDate) {
        if (createdDate < minStart) minStart = createdDate
        const calculatedEnd = calculateGoalEndDate(createdDate, goal.estimate_hours, weeklyWorkHours)
        if (calculatedEnd > maxEnd) maxEnd = calculatedEnd
      }
    }
  })

  return { start_date: minStart, end_date: maxEnd }
}

/**
 * Format date for display in timeline
 */
export function formatTimelineDate(date: Date, unit: 'day' | 'week' | 'month'): string {
  switch (unit) {
    case 'day':
      return format(date, 'MM/dd')
    case 'week':
      return format(date, 'MM/dd')
    case 'month':
      return format(date, 'yyyy/MM')
    default:
      return format(date, 'MM/dd')
  }
}

/**
 * Calculate pixel position from date
 */
export function dateToPixels(
  date: Date,
  timelineStart: Date,
  totalDays: number,
  canvasWidth: number,
  padding: { left: number; right: number }
): number {
  const daysSinceStart = differenceInDays(date, timelineStart)
  const availableWidth = canvasWidth - padding.left - padding.right

  if (totalDays <= 0) return padding.left

  const ratio = Math.max(0, Math.min(1, daysSinceStart / totalDays))
  return padding.left + ratio * availableWidth
}

/**
 * Calculate date from pixel position
 */
export function pixelsToDate(
  x: number,
  timelineStart: Date,
  totalDays: number,
  canvasWidth: number,
  padding: { left: number; right: number }
): Date {
  const availableWidth = canvasWidth - padding.left - padding.right
  const ratio = Math.max(0, Math.min(1, (x - padding.left) / availableWidth))
  const days = Math.round(ratio * totalDays)

  const result = new Date(timelineStart)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Generate L-shaped arrow path for dependencies
 */
export function generateArrowPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  horizontalOffset: number = 20
): Array<{ x: number; y: number }> {
  // Create L-shaped path: horizontal -> vertical -> horizontal
  const midX = fromX + horizontalOffset

  return [
    { x: fromX, y: fromY },
    { x: midX, y: fromY },
    { x: midX, y: toY },
    { x: toX, y: toY }
  ]
}

/**
 * Check if a value is between two other values
 */
export function isBetween(value: number, min: number, max: number): boolean {
  return value >= Math.min(min, max) && value <= Math.max(min, max)
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Calculate goal start times considering dependencies
 * Returns a map of goal ID to start time offset (in hours from project start)
 */
export function calculateDependencyBasedStartTimes(
  goals: TimelineGoal[],
  dependencyGraph: DependencyGraph
): Map<string, number> {
  const startTimes = new Map<string, number>()
  const goalMap = new Map(goals.map(g => [g.id, g]))

  // Process goals in topological order to ensure dependencies are calculated first
  for (const goalId of dependencyGraph.topological_order) {
    const goal = goalMap.get(goalId)
    if (!goal) {
      console.warn(`[Timeline] Goal not found in topological order: ${goalId}`)
      continue
    }

    // Find the maximum end time of all dependencies
    let maxDependencyEndTime = 0

    // Get all goals that this goal depends on
    const dependencies = goal.dependencies || []
    for (const depId of dependencies) {
      const depStartTime = startTimes.get(depId) || 0
      const depGoal = goalMap.get(depId)
      if (!depGoal) {
        console.warn(`[Timeline] Dependency goal not found: ${depId} for goal "${goal.title}" (${goalId})`)
        continue
      }
      const depEndTime = depStartTime + depGoal.estimate_hours
      maxDependencyEndTime = Math.max(maxDependencyEndTime, depEndTime)
    }

    // This goal starts after all its dependencies are complete
    startTimes.set(goalId, maxDependencyEndTime)

    // Debug logging
    const endTime = maxDependencyEndTime + goal.estimate_hours
    debugLog(`Goal "${goal.title}" (${goalId}): start at ${maxDependencyEndTime}h, end at ${endTime}h, duration ${goal.estimate_hours}h, dependencies: [${dependencies.join(', ')}]`)
  }

  // Handle any goals not in the topological order (shouldn't happen but defensive programming)
  for (const goal of goals) {
    if (!startTimes.has(goal.id)) {
      startTimes.set(goal.id, 0)
    }
  }

  return startTimes
}

/**
 * Convert hours offset to Date object based on weekly work hours
 */
export function hoursOffsetToDate(baseDate: Date, hoursOffset: number, weeklyWorkHours: number = 40): Date {
  const result = new Date(baseDate)
  // Calculate duration in weeks based on weekly work hours
  const weeksOffset = hoursOffset / weeklyWorkHours
  // Convert weeks to days (7 days per week)
  const daysOffset = weeksOffset * 7
  result.setTime(result.getTime() + daysOffset * 24 * 60 * 60 * 1000)
  return result
}
