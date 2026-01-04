"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Clock, Tag } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { weeklyRecurringTasksApi } from "@/lib/api"
import type { WeeklyRecurringTask } from "@/types/weekly-recurring-task"
import { logger } from "@/lib/logger"

interface WeeklyRecurringTaskSelectorProps {
  selectedTaskIds: string[]
  onSelectionChange: (taskIds: string[]) => void
  disabled?: boolean
}

export function WeeklyRecurringTaskSelector({
  selectedTaskIds,
  onSelectionChange,
  disabled = false,
}: WeeklyRecurringTaskSelectorProps) {
  const [tasks, setTasks] = useState<WeeklyRecurringTask[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const fetchTasks = useCallback(async () => {
    try {
      logger.debug('Fetching active weekly tasks', { component: 'WeeklyRecurringTaskSelector' });
      const data = await weeklyRecurringTasksApi.getActive()
      setTasks(data)
    } catch (error) {
      logger.error("Error fetching weekly tasks", error instanceof Error ? error : new Error(String(error)), { component: "WeeklyRecurringTaskSelector" })
      toast({
        title: "エラー",
        description: "週課の取得に失敗しました",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleTaskToggle = (taskId: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedTaskIds, taskId])
    } else {
      onSelectionChange(selectedTaskIds.filter(id => id !== taskId))
    }
  }

  const getTotalSelectedHours = () => {
    return tasks
      .filter(task => selectedTaskIds.includes(task.id))
      .reduce((total, task) => total + task.estimate_hours, 0)
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      WORK: "bg-blue-100 text-blue-800",
      STUDY: "bg-green-100 text-green-800",
      PERSONAL: "bg-purple-100 text-purple-800",
      HEALTH: "bg-orange-100 text-orange-800",
      OTHER: "bg-gray-100 text-gray-800",
    }
    return colors[category] || "bg-gray-100 text-gray-800"
  }

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      WORK: "仕事",
      STUDY: "勉強・学習",
      PERSONAL: "プライベート",
      HEALTH: "健康・運動",
      OTHER: "その他",
    }
    return labels[category] || category
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>週課選択</CardTitle>
          <CardDescription>この週に実行する定期タスクを選択してください</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">読み込み中...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          週課選択
          {selectedTaskIds.length > 0 && (
            <Badge variant="secondary">
              {getTotalSelectedHours()}時間選択中
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          この週に実行する定期タスクを選択してください
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>利用可能な週課がありません</p>
            <p className="text-sm mt-1">
              週課管理ページで新しい週課を作成してください
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center space-x-3 p-3 border rounded-lg ${
                  selectedTaskIds.includes(task.id)
                    ? "bg-muted/50 border-primary"
                    : "hover:bg-muted/20"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <Checkbox
                  id={`task-${task.id}`}
                  checked={selectedTaskIds.includes(task.id)}
                  onCheckedChange={(checked) =>
                    handleTaskToggle(task.id, checked as boolean)
                  }
                  disabled={disabled}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label
                      htmlFor={`task-${task.id}`}
                      className={`font-medium ${disabled ? "" : "cursor-pointer"}`}
                    >
                      {task.title}
                    </label>
                    <Badge className={getCategoryColor(task.category)}>
                      <Tag className="h-3 w-3 mr-1" />
                      {getCategoryLabel(task.category)}
                    </Badge>
                  </div>
                  {task.description && (
                    <p className="text-sm text-muted-foreground mb-2">
                      {task.description}
                    </p>
                  )}
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Clock className="h-3 w-3 mr-1" />
                    {task.estimate_hours}時間
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTaskIds.length > 0 && (
          <div className="pt-4 border-t">
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium">
                選択済み: {selectedTaskIds.length}個のタスク
              </span>
              <span className="font-medium">
                合計時間: {getTotalSelectedHours()}時間
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
