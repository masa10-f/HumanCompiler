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
import { toast } from '@/hooks/use-toast';
import { roundToDecimals, parseFloatSafe } from '@/lib/number-utils';
import { quickTasksApi } from '@/lib/api';
import type { QuickTask, QuickTaskCreate, QuickTaskUpdate } from '@/types/quick-task';

const quickTaskFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(200, '200文字以内で入力してください'),
  description: z.string().max(1000, '1000文字以内で入力してください').optional(),
  estimate_hours: z.number()
    .min(0.01, '0.01時間以上で入力してください')
    .max(999.99, '999.99時間以内で入力してください')
    .refine((val) => Number((val * 100).toFixed()) / 100 === val, {
      message: '小数点以下は2桁以内で入力してください'
    }),
  due_date: z.string().optional(),
  work_type: z.enum(['light_work', 'study', 'focused_work']).optional(),
  priority: z.number().int().min(1, '1以上で入力してください').max(5, '5以下で入力してください').optional(),
});

type QuickTaskFormData = z.infer<typeof quickTaskFormSchema>;

interface QuickTaskFormDialogProps {
  children: React.ReactNode;
  task?: QuickTask;
  onSuccess?: (task: QuickTask) => void;
}

export function QuickTaskFormDialog({ children, task, onSuccess }: QuickTaskFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!task;

  const form = useForm<QuickTaskFormData>({
    resolver: zodResolver(quickTaskFormSchema),
    defaultValues: {
      title: task?.title || '',
      description: task?.description || '',
      estimate_hours: task?.estimate_hours || 0.5,
      due_date: task?.due_date ? task.due_date.split('T')[0] : '',
      work_type: task?.work_type || 'light_work',
      priority: task?.priority || 3,
    },
  });

  // Reset form when task changes
  useEffect(() => {
    if (task) {
      form.reset({
        title: task.title,
        description: task.description || '',
        estimate_hours: task.estimate_hours,
        due_date: task.due_date ? task.due_date.split('T')[0] : '',
        work_type: task.work_type,
        priority: task.priority,
      });
    } else {
      form.reset({
        title: '',
        description: '',
        estimate_hours: 0.5,
        due_date: '',
        work_type: 'light_work',
        priority: 3,
      });
    }
  }, [task, form]);

  const onSubmit = async (data: QuickTaskFormData) => {
    setIsSubmitting(true);
    try {
      let result: QuickTask;

      if (isEditing && task) {
        // Update existing quick task
        const updateData: QuickTaskUpdate = {
          title: data.title,
          description: data.description || undefined,
          estimate_hours: data.estimate_hours,
          due_date: data.due_date || undefined,
          work_type: data.work_type || 'light_work',
          priority: data.priority || 3,
        };

        log.component('QuickTaskFormDialog', 'updateQuickTask', updateData, { taskId: task.id });
        result = await quickTasksApi.update(task.id, updateData);
        log.component('QuickTaskFormDialog', 'quickTaskUpdated', { taskTitle: data.title });

        toast({
          title: 'クイックタスクを更新しました',
          description: `「${data.title}」が正常に更新されました。`,
        });
      } else {
        // Create new quick task
        const createData: QuickTaskCreate = {
          title: data.title,
          description: data.description || undefined,
          estimate_hours: data.estimate_hours,
          due_date: data.due_date || undefined,
          work_type: data.work_type || 'light_work',
          priority: data.priority || 3,
        };

        log.component('QuickTaskFormDialog', 'createQuickTask', createData);
        result = await quickTasksApi.create(createData);
        log.component('QuickTaskFormDialog', 'quickTaskCreated', { taskTitle: data.title });

        toast({
          title: 'クイックタスクを作成しました',
          description: `「${data.title}」が正常に作成されました。`,
        });
      }

      form.reset();
      setOpen(false);
      onSuccess?.(result);
    } catch (error) {
      log.error('Failed to save quick task', error, {
        component: 'QuickTaskFormDialog',
        action: isEditing ? 'updateQuickTask' : 'createQuickTask',
      });

      toast({
        title: 'エラー',
        description: isEditing
          ? 'クイックタスクの更新に失敗しました。再試行してください。'
          : 'クイックタスクの作成に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'クイックタスク編集' : '新規クイックタスク作成'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'クイックタスクの情報を編集してください。'
              : 'プロジェクトに属さない雑多なタスクを素早く登録できます。'}
          </DialogDescription>
        </DialogHeader>
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
                      placeholder="0.50"
                      {...field}
                      onChange={(e) => {
                        const value = parseFloatSafe(e.target.value, 0);
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
              name="work_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>作業種別</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
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
                disabled={isSubmitting}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (isEditing ? '更新中...' : '作成中...') : (isEditing ? '更新' : '作成')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
