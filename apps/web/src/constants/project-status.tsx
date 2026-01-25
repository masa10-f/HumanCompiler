import React from 'react';
import { Clock, Play, CheckCircle, XCircle } from 'lucide-react';
import { ProjectStatus } from '@/types/project';

/**
 * Project status configuration with icons, labels, and styling
 */
export const PROJECT_STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: '未着手',
    color: 'muted',
    className: 'text-muted-foreground',
    bgClassName: 'bg-muted/50',
  },
  in_progress: {
    icon: Play,
    label: '進行中',
    color: 'primary',
    className: 'text-primary',
    bgClassName: 'bg-primary/10',
  },
  completed: {
    icon: CheckCircle,
    label: '完了',
    color: 'success',
    className: 'text-success',
    bgClassName: 'bg-success/10',
  },
  cancelled: {
    icon: XCircle,
    label: 'キャンセル',
    color: 'destructive',
    className: 'text-destructive',
    bgClassName: 'bg-destructive/10',
  },
} as const;

/**
 * Get status icon component
 */
export function getProjectStatusIcon(status: string, size: string = 'h-4 w-4'): React.ReactNode {
  const config = PROJECT_STATUS_CONFIG[status as ProjectStatus];
  if (!config) {
    const DefaultIcon = PROJECT_STATUS_CONFIG.pending.icon;
    return <DefaultIcon className={`${size} ${PROJECT_STATUS_CONFIG.pending.className}`} />;
  }

  const Icon = config.icon;
  return <Icon className={`${size} ${config.className}`} />;
}

/**
 * Get status label
 */
export function getProjectStatusLabel(status: string): string {
  const config = PROJECT_STATUS_CONFIG[status as ProjectStatus];
  return config ? config.label : PROJECT_STATUS_CONFIG.pending.label;
}

/**
 * Check if status is valid
 */
export function isValidProjectStatus(status: string): status is ProjectStatus {
  return status in PROJECT_STATUS_CONFIG;
}

/**
 * Get all available project statuses
 */
export function getAllProjectStatuses(): ProjectStatus[] {
  return Object.keys(PROJECT_STATUS_CONFIG) as ProjectStatus[];
}
