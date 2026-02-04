'use client';

import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUpdateTask } from '@/hooks/use-tasks-query';
import { toast } from '@/hooks/use-toast';
import { taskStatusLabels } from '@/types/task';
import { TaskDependenciesManager } from './task-dependencies-manager';
import { SessionHistory } from '@/components/runner/session-history';
import type { Task } from '@/types/task';
import { roundToDecimals, parseFloatSafe } from '@/lib/number-utils';

const taskFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  estimate_hours: z.number()
    .min(0.01, '0.01時間以上で入力してください')
    .max(999.99, '999.99時間以内で入力してください')
    .refine((val) => Number((val * 100).toFixed()) / 100 === val, {
      message: '小数点以下は2桁以内で入力してください'
    }),
  due_date: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  work_type: z.enum(['light_work', 'study', 'focused_work']).optional(),
  priority: z.number().int().min(1, '1以上で入力してください').max(5, '5以下で入力してください').optional(),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

interface TaskEditDialogProps {
  task: Task;
  availableTasks?: Task[];
  children: React.ReactNode;
}

export function TaskEditDialog({ task, availableTasks = [], children }: TaskEditDialogProps) {
  const [open, setOpen] = useState(false);
  const updateTaskMutation = useUpdateTask();

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task.title,
      description: task.description || '',
      estimate_hours: typeof task.estimate_hours === 'string' ? parseFloat(task.estimate_hours) : task.estimate_hours,
      due_date: task.due_date?.split('T')[0] || '',
      status: task.status,
      work_type: task.work_type || 'light_work',
      priority: task.priority || 3,
    },
  });

  // Update form values when task changes
  useEffect(() => {
    form.reset({
      title: task.title,
      description: task.description || '',
      estimate_hours: typeof task.estimate_hours === 'string' ? parseFloat(task.estimate_hours) : task.estimate_hours,
      due_date: task.due_date?.split('T')[0] || '',
      status: task.status,
      work_type: task.work_type || 'light_work',
      priority: task.priority || 3,
    });
  }, [task, form]);

  const onSubmit = async (data: TaskFormData) => {
    try {
      await updateTaskMutation.mutateAsync({
        id: task.id,
        data: {
          title: data.title,
          description: data.description || undefined,
          estimate_hours: data.estimate_hours,
          due_date: data.due_date || undefined,
          status: data.status,
          work_type: data.work_type || 'light_work',
          priority: data.priority || 3,
        }
      });

      toast({
        title: 'タスクを更新しました',
        description: `「${data.title}」が正常に更新されました。`,
      });

      setOpen(false);
    } catch (error) {
      log.error('Failed to update task', error, { component: 'TaskEditDialog', taskId: task.id, action: 'updateTask' });

      toast({
        title: 'エラー',
        description: 'タスクの更新に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>タスク編集</DialogTitle>
          <DialogDescription>
            タスクの情報を編集してください。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="basic">基本情報</TabsTrigger>
            <TabsTrigger value="dependencies">依存関係</TabsTrigger>
            <TabsTrigger value="history">作業履歴</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>タスク名 *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="タスク名を入力"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>説明</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="タスクの説明を入力（任意）"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="estimate_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>見積時間 (時間) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="999.99"
                      placeholder="1.00"
                      {...field}
                      onChange={(e) => {
                        const value = parseFloatSafe(e.target.value, 0);
                        // Use proper rounding utility to avoid floating point issues
                        field.onChange(roundToDecimals(value, 2));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>締切日</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ステータス *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} modal={false}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="ステータスを選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(taskStatusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="work_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>作業種別</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    modal={false}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="作業種別を選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="light_work">軽作業</SelectItem>
                      <SelectItem value="study">学習</SelectItem>
                      <SelectItem value="focused_work">集中作業</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>優先度</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value))}
                    value={field.value?.toString()}
                    modal={false}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="優先度を選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">最高</SelectItem>
                      <SelectItem value="2">高</SelectItem>
                      <SelectItem value="3">中</SelectItem>
                      <SelectItem value="4">低</SelectItem>
                      <SelectItem value="5">最低</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={updateTaskMutation.isPending}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={updateTaskMutation.isPending}>
                {updateTaskMutation.isPending ? '更新中...' : '更新'}
              </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="dependencies">
            <TaskDependenciesManager
              task={task}
              availableTasks={availableTasks}
              onDependencyAdded={() => {
                // Optionally refresh task data
              }}
              onDependencyRemoved={() => {
                // Optionally refresh task data
              }}
            />
          </TabsContent>

          <TabsContent value="history">
            <SessionHistory taskId={task.id} taskTitle={task.title} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
