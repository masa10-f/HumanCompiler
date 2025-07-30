'use client';

import { useState } from 'react';
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
import { useTasks } from '@/hooks/use-tasks';

const taskFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  estimate_hours: z.number().min(0.1, '0.1時間以上で入力してください').max(1000, '1000時間以内で入力してください'),
  due_date: z.string().optional(),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

interface TaskFormDialogProps {
  goalId: string;
  children: React.ReactNode;
}

export function TaskFormDialog({ goalId, children }: TaskFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createTask } = useTasks(goalId);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: '',
      description: '',
      estimate_hours: 1,
      due_date: '',
    },
  });

  const onSubmit = async (data: TaskFormData) => {
    try {
      setIsSubmitting(true);
      console.log('[TaskForm] Submitting task data:', data);
      console.log('[TaskForm] Goal ID:', goalId);

      const taskData = {
        title: data.title,
        description: data.description || undefined,
        estimate_hours: data.estimate_hours,
        due_date: data.due_date || undefined,
        goal_id: goalId,
      };

      console.log('[TaskForm] Final task data:', taskData);
      await createTask(taskData);
      console.log('[TaskForm] Task created successfully');

      form.reset();
      setOpen(false);
    } catch (error) {
      console.error('[TaskForm] Failed to create task:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>新規タスク作成</DialogTitle>
          <DialogDescription>
            新しいタスクの情報を入力してください。
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
                      step="0.1"
                      min="0.1"
                      max="1000"
                      placeholder="1"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
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
                {isSubmitting ? '作成中...' : '作成'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
