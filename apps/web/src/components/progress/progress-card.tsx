"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { ProjectProgress, GoalProgress, TaskProgress } from "@/types/progress";

interface ProgressCardProps {
  title: string;
  estimateHours: number;
  actualMinutes: number;
  progressPercentage: number;
  status?: string;
  className?: string;
}

export function ProgressCard({
  title,
  estimateHours,
  actualMinutes,
  progressPercentage,
  status,
  className = "",
}: ProgressCardProps) {
  // Safe number conversion with validation
  const safeEstimateHours = Number(estimateHours) || 0;
  const actualHours = actualMinutes / 60;
  const isOvertime = actualHours > safeEstimateHours;

  // Helper function for safe number formatting
  const formatHours = (value: number): string => {
    return Number(value).toFixed(1);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {status && (
            <Badge variant="secondary" className="text-xs">
              {status === "pending" && "未着手"}
              {status === "in_progress" && "進行中"}
              {status === "completed" && "完了"}
              {status === "cancelled" && "中止"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span>進捗</span>
            <span className="font-medium">
              {Math.round(progressPercentage)}%
            </span>
          </div>
          <Progress
            value={Math.min(progressPercentage, 100)}
            className="h-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">見積時間</div>
            <div className="font-medium">{formatHours(safeEstimateHours)}h</div>
          </div>
          <div>
            <div className="text-muted-foreground">実作業時間</div>
            <div className={`font-medium ${isOvertime ? "text-red-600" : ""}`}>
              {formatHours(actualHours)}h
            </div>
          </div>
        </div>

        {isOvertime && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            超過時間: {formatHours(actualHours - safeEstimateHours)}h
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ProjectProgressCardProps {
  progress: ProjectProgress;
  className?: string;
}

export function ProjectProgressCard({ progress, className }: ProjectProgressCardProps) {
  return (
    <ProgressCard
      title={progress.title}
      estimateHours={progress.estimate_hours}
      actualMinutes={progress.actual_minutes}
      progressPercentage={progress.progress_percentage}
      className={className}
    />
  );
}

interface GoalProgressCardProps {
  progress: GoalProgress;
  className?: string;
}

export function GoalProgressCard({ progress, className }: GoalProgressCardProps) {
  return (
    <ProgressCard
      title={progress.title}
      estimateHours={progress.estimate_hours}
      actualMinutes={progress.actual_minutes}
      progressPercentage={progress.progress_percentage}
      className={className}
    />
  );
}

interface TaskProgressCardProps {
  progress: TaskProgress;
  className?: string;
}

export function TaskProgressCard({ progress, className }: TaskProgressCardProps) {
  return (
    <ProgressCard
      title={progress.title}
      estimateHours={progress.estimate_hours}
      actualMinutes={progress.actual_minutes}
      progressPercentage={progress.progress_percentage}
      status={progress.status}
      className={className}
    />
  );
}
