"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Clock, Tag } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { getAuthHeaders } from "@/lib/auth"
import { getSecureApiUrl, secureFetch } from "@/lib/api"

interface WeeklyRecurringTask {
  id: string
  title: string
  description?: string
  estimate_hours: number
  category: string
  is_active: boolean
  created_at: string
  updated_at: string
}

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

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    try {
      const headers = await getAuthHeaders()
      const apiUrl = getSecureApiUrl();
      console.log(`🔄 WeeklyRecurringTaskSelector: Using API URL: ${apiUrl}`);
      if (!apiUrl) {
        throw new Error('API URL is not configured');
      }
      const fullUrl = `${apiUrl}/api/weekly-recurring-tasks?is_active=true`;
      console.log(`📡 WeeklyRecurringTaskSelector: Fetching from: ${fullUrl}`);
      const response = await secureFetch(fullUrl, {
        headers,
      })

      if (!response.ok) {
        throw new Error("Failed to fetch weekly tasks")
      }

      const data = await response.json()
      setTasks(data)
    } catch (error) {
      console.error("Error fetching weekly tasks:", error)
      toast({
        title: "エラー",
        description: "週課の取得に失敗しました",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

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
      meeting: "bg-blue-100 text-blue-800",
      study: "bg-green-100 text-green-800",
      exercise: "bg-orange-100 text-orange-800",
      hobby: "bg-purple-100 text-purple-800",
      admin: "bg-gray-100 text-gray-800",
      maintenance: "bg-cyan-100 text-cyan-800",
      review: "bg-yellow-100 text-yellow-800",
    }
    return colors[category] || "bg-gray-100 text-gray-800"
  }

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      meeting: "ミーティング",
      study: "勉強・学習",
      exercise: "運動・健康",
      hobby: "趣味・娯楽",
      admin: "事務・管理",
      maintenance: "メンテナンス",
      review: "振り返り・レビュー",
      other: "その他",
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
