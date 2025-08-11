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
import { useUpdateGoal } from '@/hooks/use-goals-query';
import { toast } from '@/hooks/use-toast';
import type { Goal } from '@/types/goal';

const goalFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  estimate_hours: z.number().min(0.1, '0.1時間以上で入力してください').max(1000, '1000時間以内で入力してください'),
});

type GoalFormData = z.infer<typeof goalFormSchema>;

interface GoalEditDialogProps {
  goal: Goal;
  children: React.ReactNode;
}

export function GoalEditDialog({ goal, children }: GoalEditDialogProps) {
  const [open, setOpen] = useState(false);
  const updateGoalMutation = useUpdateGoal();

  const form = useForm<GoalFormData>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      title: goal.title,
      description: goal.description || '',
      estimate_hours: goal.estimate_hours,
    },
  });

  // Update form values when goal changes
  useEffect(() => {
    form.reset({
      title: goal.title,
      description: goal.description || '',
      estimate_hours: goal.estimate_hours,
    });
  }, [goal, form]);

  const onSubmit = async (data: GoalFormData) => {
    try {
      await updateGoalMutation.mutateAsync({
        id: goal.id,
        data: {
          title: data.title,
          description: data.description || undefined,
          estimate_hours: data.estimate_hours,
        }
      });

      toast({
        title: 'ゴールを更新しました',
        description: `「${data.title}」が正常に更新されました。`,
      });

      setOpen(false);
    } catch (error) {
      log.error('Failed to update goal', error, { component: 'GoalEditDialog', goalId: goal.id, action: 'updateGoal' });

      toast({
        title: 'エラー',
        description: 'ゴールの更新に失敗しました。再試行してください。',
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
          <DialogTitle>ゴール編集</DialogTitle>
          <DialogDescription>
            ゴールの情報を編集してください。
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
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={updateGoalMutation.isPending}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={updateGoalMutation.isPending}>
                {updateGoalMutation.isPending ? '更新中...' : '更新'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
