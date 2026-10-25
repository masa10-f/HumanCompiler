'use client';

import { useState } from 'react';
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
import { useCreateGoal } from '@/hooks/use-goals-query';
import { toast } from '@/hooks/use-toast';
import { toJSTStartOfDayISOString } from '@/lib/date-utils';
import { goalDueDateSchema } from '@/lib/validations/goal';

const goalFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  due_date: goalDueDateSchema,
});

type GoalFormData = z.infer<typeof goalFormSchema>;

/**
 * Props for GoalFormDialog component.
 */
interface GoalFormDialogProps {
  /** Project UUID to associate the new goal with */
  projectId: string;
  /** Trigger element that opens the dialog */
  children: React.ReactNode;
}

/**
 * Dialog component for creating a new goal.
 * Provides a form with validation for goal creation.
 */
export function GoalFormDialog({ projectId, children }: GoalFormDialogProps) {
  const [open, setOpen] = useState(false);
  const createGoalMutation = useCreateGoal();

  const form = useForm<GoalFormData>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      title: '',
      description: '',
      due_date: '',
    },
  });

  const onSubmit = async (data: GoalFormData) => {
    try {
      await createGoalMutation.mutateAsync({
        title: data.title,
        description: data.description || undefined,
        due_date: data.due_date ? toJSTStartOfDayISOString(data.due_date) : undefined,
        project_id: projectId,
      });

      toast({
        title: 'ゴールを作成しました',
        description: `「${data.title}」が正常に作成されました。`,
      });

      form.reset();
      setOpen(false);
    } catch (error) {
      log.error('Failed to create goal', error, { component: 'GoalFormDialog', projectId, action: 'createGoal' });

      toast({
        title: 'エラー',
        description: 'ゴールの作成に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>新規ゴール作成</DialogTitle>
          <DialogDescription>
            新しいゴールの情報を入力してください。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ゴール名 *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="ゴール名を入力"
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
                      placeholder="ゴールの説明を入力（任意）"
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
              name="due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>期限</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
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
                disabled={createGoalMutation.isPending}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={createGoalMutation.isPending}>
                {createGoalMutation.isPending ? '作成中...' : '作成'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
