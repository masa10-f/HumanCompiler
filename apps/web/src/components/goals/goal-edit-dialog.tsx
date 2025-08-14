'use client';

import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useUpdateGoal, useGoalsByProject } from '@/hooks/use-goals-query';
import { toast } from '@/hooks/use-toast';
import { goalsApi } from '@/lib/api';
import { GitBranch, Trash2, Plus } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('basic');
  const [selectedDependencyGoal, setSelectedDependencyGoal] = useState<string>('');

  const updateGoalMutation = useUpdateGoal();

  // Fetch available goals for dependencies (same project)
  const { data: availableGoals = [] } = useGoalsByProject(goal.project_id);

  // Fetch goal dependencies
  const { data: dependencies = [], refetch: refetchDependencies } = useQuery({
    queryKey: ['goalDependencies', goal.id],
    queryFn: () => goalsApi.getDependencies(goal.id),
    enabled: open,
  });

  // Add dependency mutation
  const addDependencyMutation = useMutation({
    mutationFn: (dependsOnGoalId: string) =>
      goalsApi.addDependency({ goal_id: goal.id, depends_on_goal_id: dependsOnGoalId }),
    onSuccess: () => {
      toast({
        title: '依存関係を追加しました',
        description: '依存関係が正常に追加されました。',
      });
      refetchDependencies();
      setSelectedDependencyGoal('');
    },
    onError: (error: Error) => {
      log.error('Failed to add goal dependency', error, { goalId: goal.id });
      toast({
        title: 'エラー',
        description: error.message || '依存関係の追加に失敗しました。',
        variant: 'destructive',
      });
    },
  });

  // Delete dependency mutation
  const deleteDependencyMutation = useMutation({
    mutationFn: (dependencyId: string) => goalsApi.deleteDependency(dependencyId),
    onSuccess: () => {
      toast({
        title: '依存関係を削除しました',
        description: '依存関係が正常に削除されました。',
      });
      refetchDependencies();
    },
    onError: (error: Error) => {
      log.error('Failed to delete goal dependency', error, { goalId: goal.id });
      toast({
        title: 'エラー',
        description: error.message || '依存関係の削除に失敗しました。',
        variant: 'destructive',
      });
    },
  });

  // Filter goals that can be dependencies (exclude self and existing dependencies)
  const availableDependencyGoals = availableGoals.filter(g =>
    g.id !== goal.id &&
    !dependencies.some(dep => dep.depends_on_goal_id === g.id)
  );

  const form = useForm<GoalFormData>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      title: goal.title,
      description: goal.description || '',
      estimate_hours: typeof goal.estimate_hours === 'string' ? parseFloat(goal.estimate_hours) : goal.estimate_hours,
    },
  });

  // Update form values when goal changes
  useEffect(() => {
    form.reset({
      title: goal.title,
      description: goal.description || '',
      estimate_hours: typeof goal.estimate_hours === 'string' ? parseFloat(goal.estimate_hours) : goal.estimate_hours,
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

  const handleAddDependency = () => {
    if (selectedDependencyGoal) {
      addDependencyMutation.mutate(selectedDependencyGoal);
    }
  };

  const handleDeleteDependency = (dependencyId: string) => {
    deleteDependencyMutation.mutate(dependencyId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ゴール編集</DialogTitle>
          <DialogDescription>
            ゴールの基本情報と依存関係を管理してください。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">基本情報</TabsTrigger>
            <TabsTrigger value="dependencies">
              <GitBranch className="h-4 w-4 mr-2" />
              依存関係
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
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
          </TabsContent>

          <TabsContent value="dependencies" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-3">依存関係を追加</h4>
                <div className="flex gap-2">
                  <Select value={selectedDependencyGoal} onValueChange={setSelectedDependencyGoal}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="依存するゴールを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDependencyGoals.map((availableGoal) => (
                        <SelectItem key={availableGoal.id} value={availableGoal.id}>
                          {availableGoal.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleAddDependency}
                    disabled={!selectedDependencyGoal || addDependencyMutation.isPending}
                    size="sm"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {availableDependencyGoals.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    依存関係に追加できるゴールがありません。
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3">現在の依存関係</h4>
                {dependencies.length > 0 ? (
                  <div className="space-y-2">
                    {dependencies.map((dependency) => {
                      const dependsOnGoal = availableGoals.find(g => g.id === dependency.depends_on_goal_id);
                      return (
                        <Card key={dependency.id}>
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <GitBranch className="h-4 w-4 text-blue-500" />
                                <div>
                                  <div className="font-medium">{dependsOnGoal?.title || '不明なゴール'}</div>
                                  <div className="text-sm text-gray-500">
                                    このゴールの完了を待つ
                                  </div>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteDependency(dependency.id)}
                                disabled={deleteDependencyMutation.isPending}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-4 text-center text-gray-500">
                      <GitBranch className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">依存関係はまだ設定されていません</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                閉じる
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
