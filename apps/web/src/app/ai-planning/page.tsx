'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  Calendar,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Loader2,
  BarChart3,
  Target,
  Key,
  Archive,
  Eye,
  Trash2,
  RefreshCw,
  Save,
  Plus,
  Edit,
  Tag
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { WeeklyRecurringTaskSelector } from '@/components/weekly-recurring-task-selector';
import { WeeklyRecurringTaskDialog } from '@/components/weekly-recurring-task-dialog';
import { toast } from '@/hooks/use-toast';
import { aiPlanningApi, weeklyScheduleApi } from '@/lib/api';
import { log } from '@/lib/logger';
import type { WeeklyPlanResponse, WorkloadAnalysis, PrioritySuggestions, SavedWeeklySchedule } from '@/types/ai-planning';
import { getAuthHeaders } from '@/lib/auth';

interface WeeklyRecurringTask {
  id: string;
  title: string;
  description?: string;
  estimate_hours: number;
  category: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function AIPlanningPage() {
  const { user, session, loading: authLoading } = useAuth();
  const { projects } = useProjects();
  const router = useRouter();

  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedRecurringTaskIds, setSelectedRecurringTaskIds] = useState<string[]>([]);
  const [weekStartDate, setWeekStartDate] = useState(() => {
    const today = new Date();
    const monday = new Date(today);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(today.getDate() + daysToMonday);
    return monday.toISOString().split('T')[0];
  });
  const [capacityHours, setCapacityHours] = useState(40);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlanResponse | null>(null);
  const [workloadAnalysis, setWorkloadAnalysis] = useState<WorkloadAnalysis | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [checkingApiKey, setCheckingApiKey] = useState(true);

  const checkUserSettings = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      log.error('Environment variable NEXT_PUBLIC_API_URL is not defined', null, { component: 'AIPlanning' });
      toast({
        title: 'エラー',
        description: 'ユーザー設定を取得できません。サポートまでお問い合わせください。',
        variant: 'destructive',
      });
      setCheckingApiKey(false);
      return;
    }

    if (!session?.access_token) {
      log.error('No authenticated session found', null, { component: 'AIPlanning' });
      toast({
        title: 'エラー',
        description: '認証が必要です。ログインしてください。',
        variant: 'destructive',
      });
      setCheckingApiKey(false);
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/api/user/settings`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setHasApiKey(data.has_api_key);
      } else {
        log.error('Failed to fetch user settings', null, { component: 'AIPlanning', status: response.status });
      }
    } catch (error) {
      log.error('Failed to check user settings', error as Error, { component: 'AIPlanning' });
    } finally {
      setCheckingApiKey(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      checkUserSettings();
    } else if (!authLoading) {
      setCheckingApiKey(false);
    }
  }, [session, authLoading, checkUserSettings]);

  const [prioritySuggestions, setPrioritySuggestions] = useState<PrioritySuggestions | null>(null);
  const [savedSchedules, setSavedSchedules] = useState<SavedWeeklySchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<SavedWeeklySchedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Weekly Recurring Tasks state
  const [weeklyTasks, setWeeklyTasks] = useState<WeeklyRecurringTask[]>([]);
  const [loadingWeeklyTasks, setLoadingWeeklyTasks] = useState(false);
  const [weeklyTaskDialogOpen, setWeeklyTaskDialogOpen] = useState(false);
  const [editingWeeklyTask, setEditingWeeklyTask] = useState<WeeklyRecurringTask | null>(null);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const handleProjectSelection = (projectId: string, checked: boolean) => {
    if (checked) {
      setSelectedProjects(prev => [...prev, projectId]);
    } else {
      setSelectedProjects(prev => prev.filter(id => id !== projectId));
    }
  };

  const generateWeeklyPlan = async () => {
    try {
      setIsGenerating(true);

      const response = await aiPlanningApi.generateWeeklyPlan({
        week_start_date: weekStartDate as string,
        capacity_hours: capacityHours,
        project_filter: selectedProjects.length > 0 ? selectedProjects : undefined,
        selected_recurring_task_ids: selectedRecurringTaskIds,
        preferences: {}
      });

      setWeeklyPlan(response);
      toast({
        title: '週間計画を生成しました',
        description: `${response.task_plans.length}個のタスクが計画されました`,
      });
    } catch (error) {
      toast({
        title: '計画生成に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const analyzeWorkload = async () => {
    try {
      setIsAnalyzing(true);

      const response = await aiPlanningApi.analyzeWorkload(
        selectedProjects.length > 0 ? selectedProjects : undefined
      );

      setWorkloadAnalysis(response);

      // Also get priority suggestions
      const priorityResponse = await aiPlanningApi.suggestPriorities(
        selectedProjects.length > 0 ? selectedProjects[0] : undefined
      );
      setPrioritySuggestions(priorityResponse);

      toast({
        title: 'ワークロード分析が完了しました',
        description: `${response.analysis.total_tasks}個のタスクを分析しました`,
      });
    } catch (error) {
      toast({
        title: '分析に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const loadSavedSchedules = async () => {
    try {
      setLoadingSchedules(true);
      const schedules = await weeklyScheduleApi.getAll();
      setSavedSchedules(schedules);
    } catch (error) {
      toast({
        title: '保存済み週間スケジュールの取得に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setLoadingSchedules(false);
    }
  };

  const viewScheduleDetails = async (weekStartDate: string) => {
    try {
      const schedule = await weeklyScheduleApi.getByWeek(weekStartDate);
      setSelectedSchedule(schedule);
    } catch (error) {
      toast({
        title: '週間スケジュールの詳細取得に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    }
  };

  const saveWeeklySchedule = async () => {
    if (!weeklyPlan) return;

    try {
      setSavingSchedule(true);
      const scheduleData = {
        selected_tasks: weeklyPlan.task_plans,
        total_allocated_hours: weeklyPlan.total_planned_hours,
        project_allocations: weeklyPlan.project_allocations || [],
        optimization_insights: weeklyPlan.insights || [],
        recommendations: weeklyPlan.recommendations || [],
        capacity_hours: capacityHours,
        generation_timestamp: new Date().toISOString(),
      };

      await weeklyScheduleApi.save(weeklyPlan.week_start_date, scheduleData);

      toast({
        title: '週間スケジュールを保存しました',
        description: `${weeklyPlan.week_start_date}週の計画が保存されました`,
      });

      // Refresh saved schedules list if it's loaded
      if (savedSchedules.length > 0) {
        loadSavedSchedules();
      }
    } catch (error) {
      toast({
        title: '週間スケジュールの保存に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const deleteSchedule = async (weekStartDate: string) => {
    try {
      await weeklyScheduleApi.delete(weekStartDate);
      setSavedSchedules(prev => prev.filter(s => s.week_start_date !== weekStartDate));
      if (selectedSchedule?.week_start_date === weekStartDate) {
        setSelectedSchedule(null);
      }
      toast({
        title: '週間スケジュールを削除しました',
      });
    } catch (error) {
      toast({
        title: '週間スケジュールの削除に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラーが発生しました',
        variant: 'destructive',
      });
    }
  };

  // Weekly Recurring Tasks functions
  const fetchWeeklyTasks = async () => {
    try {
      setLoadingWeeklyTasks(true);
      const headers = await getAuthHeaders();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;

      const response = await fetch(`${apiUrl}/api/weekly-recurring-tasks`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch weekly tasks');
      }

      const data = await response.json();
      setWeeklyTasks(data);
    } catch (error) {
      toast({
        title: 'エラー',
        description: '週課の取得に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setLoadingWeeklyTasks(false);
    }
  };

  const handleCreateWeeklyTask = () => {
    setEditingWeeklyTask(null);
    setWeeklyTaskDialogOpen(true);
  };

  const handleEditWeeklyTask = (task: WeeklyRecurringTask) => {
    setEditingWeeklyTask(task);
    setWeeklyTaskDialogOpen(true);
  };

  const handleDeleteWeeklyTask = async (taskId: string) => {
    if (!confirm('この週課を削除しますか？')) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;

      const response = await fetch(`${apiUrl}/api/weekly-recurring-tasks/${taskId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to delete task');
      }

      toast({
        title: '成功',
        description: '週課を削除しました',
      });

      fetchWeeklyTasks();
    } catch (error) {
      toast({
        title: 'エラー',
        description: '週課の削除に失敗しました',
        variant: 'destructive',
      });
    }
  };

  const handleWeeklyTaskSaved = () => {
    setWeeklyTaskDialogOpen(false);
    setEditingWeeklyTask(null);
    fetchWeeklyTasks();
    // Force refresh of WeeklyRecurringTaskSelector component by updating a key
    setSelectedRecurringTaskIds([]); // Reset selected tasks to force refresh
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      meeting: 'bg-blue-100 text-blue-800',
      study: 'bg-green-100 text-green-800',
      exercise: 'bg-orange-100 text-orange-800',
      hobby: 'bg-purple-100 text-purple-800',
      admin: 'bg-gray-100 text-gray-800',
      maintenance: 'bg-indigo-100 text-indigo-800',
      review: 'bg-pink-100 text-pink-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="ai-planning" />

      <div className="container mx-auto py-8">
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="h-8 w-8 text-purple-600" />
              AI週間計画
            </h1>
          </div>
          <p className="text-gray-600">
            AIがあなたのタスクを分析し、最適な週間計画を提案します。
          </p>
        </div>

      {checkingApiKey ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="ml-2">設定を確認中...</span>
        </div>
      ) : !hasApiKey ? (
        <Alert>
          <Key className="h-4 w-4" />
          <AlertTitle>OpenAI APIキーが未設定です</AlertTitle>
          <AlertDescription>
            AI機能を使用するには、まずOpenAI APIキーを設定してください。
            <Button
              variant="link"
              className="ml-2 p-0"
              onClick={() => router.push('/settings')}
            >
              設定ページへ移動
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {hasApiKey && (
        <Tabs defaultValue="planning" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="planning">週間計画生成</TabsTrigger>
          <TabsTrigger value="weekly-tasks">週課管理</TabsTrigger>
          <TabsTrigger value="saved">保存済みスケジュール</TabsTrigger>
          <TabsTrigger value="analysis">ワークロード分析</TabsTrigger>
          <TabsTrigger value="priorities">優先度提案</TabsTrigger>
        </TabsList>

        <TabsContent value="planning" className="space-y-6">
          {/* Planning Form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                計画設定
              </CardTitle>
              <CardDescription>
                週間計画の生成条件を設定してください。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="week-start">週開始日</Label>
                  <Input
                    id="week-start"
                    type="date"
                    value={weekStartDate}
                    onChange={(e) => setWeekStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity">週間作業時間 (時間)</Label>
                  <Input
                    id="capacity"
                    type="number"
                    min="1"
                    max="168"
                    value={capacityHours}
                    onChange={(e) => setCapacityHours(parseInt(e.target.value) || 40)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>対象プロジェクト (任意)</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                  {projects.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={project.id}
                        checked={selectedProjects.includes(project.id)}
                        onCheckedChange={(checked) =>
                          handleProjectSelection(project.id, checked as boolean)
                        }
                      />
                      <Label htmlFor={project.id} className="text-sm">
                        {project.title}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <WeeklyRecurringTaskSelector
                selectedTaskIds={selectedRecurringTaskIds}
                onSelectionChange={setSelectedRecurringTaskIds}
                disabled={isGenerating}
              />

              <Button
                onClick={generateWeeklyPlan}
                disabled={isGenerating || !hasApiKey}
                className="w-full"
              >
                {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                AI週間計画を生成
              </Button>
            </CardContent>
          </Card>

          {/* Weekly Plan Results */}
          {weeklyPlan && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      週間計画結果
                    </CardTitle>
                    <CardDescription>
                      {weeklyPlan.week_start_date}週の計画が生成されました
                    </CardDescription>
                  </div>
                  <Button
                    onClick={saveWeeklySchedule}
                    disabled={savingSchedule}
                    className="flex items-center gap-2"
                  >
                    {savingSchedule ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    スケジュールを保存
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="text-2xl font-bold">{weeklyPlan.task_plans.length}</div>
                          <div className="text-xs text-gray-500">計画されたタスク</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-purple-600" />
                        <div>
                          <div className="text-2xl font-bold">{weeklyPlan.total_planned_hours}h</div>
                          <div className="text-xs text-gray-500">計画時間</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {Math.round((weeklyPlan.total_planned_hours / capacityHours) * 100)}%
                          </div>
                          <div className="text-xs text-gray-500">作業時間活用率</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                <div>
                  <h4 className="text-lg font-semibold mb-3">タスク計画</h4>
                  <div className="space-y-2">
                    {weeklyPlan.task_plans.map((plan, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{plan.task_title}</div>
                          <div className="text-sm text-gray-600">{plan.rationale}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-gray-500">
                            {plan.estimated_hours}h
                          </div>
                          <Badge
                            className={
                              plan.priority <= 2 ? 'bg-red-100 text-red-800' :
                              plan.priority <= 3 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }
                          >
                            優先度{plan.priority}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {weeklyPlan.recommendations.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">推奨事項</h4>
                    <ul className="space-y-1">
                      {weeklyPlan.recommendations.map((rec, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {weeklyPlan.insights.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">洞察</h4>
                    <ul className="space-y-1">
                      {weeklyPlan.insights.map((insight, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <TrendingUp className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="weekly-tasks" className="space-y-6">
          {/* Weekly Tasks Management */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5" />
                    週課管理
                  </CardTitle>
                  <CardDescription>
                    定期的に行う週単位のタスクを管理します
                  </CardDescription>
                </div>
                <Button
                  onClick={handleCreateWeeklyTask}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  新しい週課を追加
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                onClick={fetchWeeklyTasks}
                disabled={loadingWeeklyTasks}
                className="w-full mb-4"
                variant="outline"
              >
                {loadingWeeklyTasks && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <RefreshCw className="mr-2 h-4 w-4" />
                週課一覧を更新
              </Button>

              {weeklyTasks.length === 0 && !loadingWeeklyTasks && (
                <div className="text-center py-12 text-gray-500">
                  週課が登録されていません。
                  <br />
                  新しい週課を追加してください。
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {weeklyTasks.map((task) => (
                  <Card key={task.id} className={`${!task.is_active ? 'opacity-50' : ''}`}>
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
                            onClick={() => handleEditWeeklyTask(task)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteWeeklyTask(task.id)}
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
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="h-4 w-4" />
                        {task.estimate_hours}時間
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="saved" className="space-y-6">
          {/* Saved Schedules List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Archive className="h-5 w-5" />
                保存済み週間スケジュール
              </CardTitle>
              <CardDescription>
                過去に生成した週間スケジュールを閲覧・管理できます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={loadSavedSchedules}
                disabled={loadingSchedules}
                className="w-full mb-4"
              >
                {loadingSchedules && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <RefreshCw className="mr-2 h-4 w-4" />
                スケジュール一覧を更新
              </Button>

              {savedSchedules.length === 0 && !loadingSchedules && (
                <div className="text-center py-8 text-gray-500">
                  保存済みの週間スケジュールがありません。
                  <br />
                  「週間計画生成」タブで新しい計画を作成してください。
                </div>
              )}

              <div className="space-y-3">
                {savedSchedules.map((schedule) => (
                  <div key={schedule.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium">
                        {new Date(schedule.week_start_date).toLocaleDateString('ja-JP', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}週の計画
                      </div>
                      <div className="text-sm text-gray-600">
                        {schedule.schedule_json.selected_tasks.length}個のタスク・
                        {schedule.schedule_json.total_allocated_hours}時間
                      </div>
                      <div className="text-xs text-gray-500">
                        作成日: {new Date(schedule.created_at).toLocaleDateString('ja-JP')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const dateOnly = schedule.week_start_date?.split('T')[0];
                          if (dateOnly) viewScheduleDetails(dateOnly);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        詳細
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const dateOnly = schedule.week_start_date?.split('T')[0];
                          if (dateOnly) deleteSchedule(dateOnly);
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Schedule Details */}
          {selectedSchedule && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  週間スケジュール詳細
                </CardTitle>
                <CardDescription>
                  {new Date(selectedSchedule.week_start_date).toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}週の計画詳細
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {selectedSchedule.schedule_json.selected_tasks.length}
                          </div>
                          <div className="text-xs text-gray-500">選択されたタスク</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-purple-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {selectedSchedule.schedule_json.total_allocated_hours}h
                          </div>
                          <div className="text-xs text-gray-500">割り当て時間</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="text-2xl font-bold">
                            {selectedSchedule.schedule_json.project_allocations.length}
                          </div>
                          <div className="text-xs text-gray-500">関与プロジェクト</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                <div>
                  <h4 className="text-lg font-semibold mb-3">選択されたタスク</h4>
                  <div className="space-y-2">
                    {selectedSchedule.schedule_json.selected_tasks.map((task, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{task.task_title}</div>
                          <div className="text-sm text-gray-600">{task.rationale}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-gray-500">
                            {task.estimated_hours}h
                          </div>
                          <Badge
                            className={
                              task.priority <= 2 ? 'bg-red-100 text-red-800' :
                              task.priority <= 3 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }
                          >
                            優先度{task.priority}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedSchedule.schedule_json.optimization_insights?.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">最適化の洞察</h4>
                    <ul className="space-y-1">
                      {selectedSchedule.schedule_json.optimization_insights.map((insight, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <TrendingUp className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedSchedule.schedule_json.project_allocations?.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">プロジェクト配分</h4>
                    <div className="space-y-2">
                      {selectedSchedule.schedule_json.project_allocations.map((allocation, index) => (
                        <div key={index} className="flex items-center justify-between p-2 border rounded">
                          <span className="font-medium">{allocation.project_title}</span>
                          <div className="text-sm text-gray-600">
                            目標: {allocation.target_hours}h / 最大: {allocation.max_hours}h
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                ワークロード分析
              </CardTitle>
              <CardDescription>
                現在のタスク量と工数を分析します。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={analyzeWorkload}
                disabled={isAnalyzing}
                className="w-full"
              >
                {isAnalyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                ワークロードを分析
              </Button>
            </CardContent>
          </Card>

          {workloadAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle>分析結果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">
                        {workloadAnalysis.analysis.total_estimated_hours}h
                      </div>
                      <div className="text-xs text-gray-500">総見積時間</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">
                        {workloadAnalysis.analysis.total_tasks}
                      </div>
                      <div className="text-xs text-gray-500">総タスク数</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-red-600">
                        {workloadAnalysis.analysis.overdue_tasks}
                      </div>
                      <div className="text-xs text-gray-500">遅延タスク</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-yellow-600">
                        {workloadAnalysis.analysis.urgent_tasks}
                      </div>
                      <div className="text-xs text-gray-500">緊急タスク</div>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h4 className="text-lg font-semibold mb-3">プロジェクト別工数配分</h4>
                  <div className="space-y-2">
                    {Object.entries(workloadAnalysis.analysis.project_distribution).map(([project, hours]) => (
                      <div key={project} className="flex items-center justify-between p-2 border rounded">
                        <span className="font-medium">{project}</span>
                        <span className="text-sm text-gray-600">{hours}時間</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-semibold mb-3">推奨事項</h4>
                  <ul className="space-y-1">
                    {workloadAnalysis.recommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="priorities" className="space-y-6">
          {prioritySuggestions && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  タスク優先度提案
                </CardTitle>
                <CardDescription>
                  AIが分析したタスクの優先度提案です。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-gray-600 mb-4">
                  分析対象: {prioritySuggestions.total_tasks_analyzed}個のタスク
                </div>

                <div className="space-y-2">
                  {prioritySuggestions.priority_suggestions.map((suggestion, index) => (
                    <div key={index} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">{suggestion.task_title}</div>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={
                              suggestion.suggested_priority <= 2 ? 'bg-red-100 text-red-800' :
                              suggestion.suggested_priority <= 3 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }
                          >
                            優先度{suggestion.suggested_priority}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {suggestion.current_estimate_hours}h
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        理由: {suggestion.reasoning.join(', ')}
                      </div>
                      {suggestion.due_date && (
                        <div className="text-xs text-gray-500 mt-1">
                          締切: {new Date(suggestion.due_date).toLocaleDateString('ja-JP')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <h4 className="text-lg font-semibold mb-3">分析手法</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    {prioritySuggestions.methodology.factors.map((factor, index) => (
                      <div key={index}>• {factor}</div>
                    ))}
                    <div className="mt-2">
                      <strong>優先度スケール:</strong> {prioritySuggestions.methodology.priority_scale}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      )}

      {/* Weekly Recurring Task Dialog */}
      <WeeklyRecurringTaskDialog
        open={weeklyTaskDialogOpen}
        onOpenChange={setWeeklyTaskDialogOpen}
        task={editingWeeklyTask}
        onSaved={handleWeeklyTaskSaved}
      />
      </div>
    </div>
  );
}
