"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { getAuthHeaders } from "@/lib/auth"

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

interface WeeklyRecurringTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: WeeklyRecurringTask | null
  onSaved: () => void
}

const CATEGORIES = [
  { value: "meeting", label: "ミーティング" },
  { value: "study", label: "勉強・学習" },
  { value: "exercise", label: "運動・健康" },
  { value: "hobby", label: "趣味・娯楽" },
  { value: "admin", label: "事務・管理" },
  { value: "maintenance", label: "メンテナンス" },
  { value: "review", label: "振り返り・レビュー" },
  { value: "other", label: "その他" },
]

export function WeeklyRecurringTaskDialog({
  open,
  onOpenChange,
  task,
  onSaved,
}: WeeklyRecurringTaskDialogProps) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    estimate_hours: 1,
    category: "other",
    is_active: true,
  })
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title,
        description: task.description || "",
        estimate_hours: task.estimate_hours,
        category: task.category,
        is_active: task.is_active,
      })
    } else {
      setFormData({
        title: "",
        description: "",
        estimate_hours: 1,
        category: "other",
        is_active: true,
      })
    }
  }, [task, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) {
      toast({
        title: "エラー",
        description: "タイトルを入力してください",
        variant: "destructive",
      })
      return
    }

    if (formData.estimate_hours <= 0) {
      toast({
        title: "エラー",
        description: "見積もり時間は0より大きい値を入力してください",
        variant: "destructive",
      })
      return
    }

    setSaving(true)

    try {
      const url = task
        ? `/api/weekly-recurring-tasks/${task.id}`
        : "/api/weekly-recurring-tasks"

      const method = task ? "PUT" : "POST"
      const headers = await getAuthHeaders()

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error("Failed to save task")
      }

      toast({
        title: "成功",
        description: task ? "週課を更新しました" : "週課を作成しました",
      })

      onSaved()
    } catch (error) {
      console.error("Error saving task:", error)
      toast({
        title: "エラー",
        description: "週課の保存に失敗しました",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {task ? "週課を編集" : "新しい週課を作成"}
          </DialogTitle>
          <DialogDescription>
            定期的に行う週単位のタスクの詳細を入力してください。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">タイトル *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="例: 週次振り返り会議"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">説明</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="タスクの詳細や目的を入力してください"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimate_hours">見積もり時間 *</Label>
              <Input
                id="estimate_hours"
                type="number"
                min="0.5"
                max="40"
                step="0.5"
                value={formData.estimate_hours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    estimate_hours: parseFloat(e.target.value) || 1,
                  })
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">カテゴリ *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  setFormData({ ...formData, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_active: checked })
              }
            />
            <Label htmlFor="is_active">有効</Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中..." : task ? "更新" : "作成"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
