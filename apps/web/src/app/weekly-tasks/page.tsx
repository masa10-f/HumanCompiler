"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Edit, Trash2, Clock, Tag } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import { WeeklyRecurringTaskDialog } from "@/components/weekly-recurring-task-dialog"
import { weeklyRecurringTasksApi } from "@/lib/api"
import type { WeeklyRecurringTask } from "@/types/weekly-recurring-task"
import { AppHeader } from "@/components/layout/app-header"
import { logger } from "@/lib/logger"

export default function WeeklyTasksPage() {
  const [tasks, setTasks] = useState<WeeklyRecurringTask[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<WeeklyRecurringTask | null>(null)

  const fetchTasks = async () => {
    try {
      const tasks = await weeklyRecurringTasksApi.getAll()
      setTasks(tasks)
    } catch (error) {
      logger.error("Error fetching weekly tasks", error instanceof Error ? error : new Error(String(error)), { component: "WeeklyTasksPage" })
      toast({
        title: "エラー",
        description: "週課の取得に失敗しました",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  const handleCreateTask = () => {
    setEditingTask(null)
    setDialogOpen(true)
  }

  const handleEditTask = (task: WeeklyRecurringTask) => {
    setEditingTask(task)
    setDialogOpen(true)
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("この週課を削除しますか？")) {
      return
    }

    try {
      await weeklyRecurringTasksApi.delete(taskId)

      toast({
        title: "成功",
        description: "週課を削除しました",
      })

      fetchTasks()
    } catch (error) {
      logger.error("Error deleting task", error instanceof Error ? error : new Error(String(error)), { component: "WeeklyTasksPage" })
      toast({
        title: "エラー",
        description: "週課の削除に失敗しました",
        variant: "destructive",
      })
    }
  }

  const handleTaskSaved = () => {
    setDialogOpen(false)
    setEditingTask(null)
    fetchTasks()
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      meeting: "bg-blue-100 text-blue-800",
      study: "bg-green-100 text-green-800",
      exercise: "bg-orange-100 text-orange-800",
      hobby: "bg-purple-100 text-purple-800",
      admin: "bg-gray-100 text-gray-800",
    }
    return colors[category] || "bg-gray-100 text-gray-800"
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="ai-planning" />
      <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">週課管理</h1>
          <p className="text-muted-foreground mt-2">
            定期的に行う週単位のタスクを管理します
          </p>
        </div>
        <Button onClick={handleCreateTask} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          新しい週課を追加
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tasks.map((task) => (
          <Card key={task.id} className={`${!task.is_active ? "opacity-50" : ""}`}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <CardTitle className="text-lg">{task.title}</CardTitle>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className={getCategoryColor(task.category)}>
                      <Tag className="h-3 w-3 mr-1" />
                      {task.category}
                    </Badge>
                    {!task.is_active && (
                      <Badge variant="secondary">無効</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditTask(task)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {task.description && (
                <CardDescription className="mb-3">
                  {task.description}
                </CardDescription>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {task.estimate_hours}時間
              </div>
            </CardContent>
          </Card>
        ))}

        {tasks.length === 0 && (
          <div className="col-span-full text-center py-12">
            <p className="text-muted-foreground">週課が登録されていません</p>
            <Button onClick={handleCreateTask} className="mt-4">
              最初の週課を追加
            </Button>
          </div>
        )}
      </div>

      <WeeklyRecurringTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        onSaved={handleTaskSaved}
      />
      </div>
    </div>
  )
}
