import React from 'react';
import { Clock, Play, CheckCircle, XCircle } from 'lucide-react';
import { GoalStatus } from '@/types/goal';

/**
 * Goal status configuration with icons, labels, and styling
 */
export const GOAL_STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: '未着手',
    color: 'gray',
    className: 'text-gray-500',
  },
  in_progress: {
    icon: Play,
    label: '進行中',
    color: 'blue',
    className: 'text-blue-500',
  },
  completed: {
    icon: CheckCircle,
    label: '完了',
    color: 'green',
    className: 'text-green-500',
  },
  cancelled: {
    icon: XCircle,
    label: 'キャンセル',
    color: 'red',
    className: 'text-red-500',
  },
} as const;

/**
 * Get status icon component
 */
export function getGoalStatusIcon(status: string, size: string = 'h-4 w-4'): React.ReactNode {
  const config = GOAL_STATUS_CONFIG[status as GoalStatus];
  if (!config) {
    const DefaultIcon = GOAL_STATUS_CONFIG.pending.icon;
    return <DefaultIcon className={`${size} ${GOAL_STATUS_CONFIG.pending.className}`} />;
  }

  const Icon = config.icon;
  return <Icon className={`${size} ${config.className}`} />;
}

/**
 * Get status label
 */
export function getGoalStatusLabel(status: string): string {
  const config = GOAL_STATUS_CONFIG[status as GoalStatus];
  return config ? config.label : GOAL_STATUS_CONFIG.pending.label;
}

/**
 * Check if status is valid
 */
export function isValidGoalStatus(status: string): status is GoalStatus {
  return status in GOAL_STATUS_CONFIG;
}

/**
 * Get all available goal statuses
 */
export function getAllGoalStatuses(): GoalStatus[] {
  return Object.keys(GOAL_STATUS_CONFIG) as GoalStatus[];
}
