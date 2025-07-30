'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
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
  ArrowLeft
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { aiPlanningApi } from '@/lib/api';
import type { WeeklyPlanResponse, WorkloadAnalysis, PrioritySuggestions } from '@/types/ai-planning';

export default function AIPlanningPage() {
  const { user, loading: authLoading } = useAuth();
  const { projects } = useProjects();
  const router = useRouter();

  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
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
  const [prioritySuggestions, setPrioritySuggestions] = useState<PrioritySuggestions | null>(null);

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

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="h-8 w-8 text-purple-600" />
            AI週間計画
          </h1>
          <Button
            variant="outline"
            onClick={() => router.back()}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            戻る
          </Button>
        </div>
        <p className="text-gray-600">
          AIがあなたのタスクを分析し、最適な週間計画を提案します。
        </p>
      </div>

      <Tabs defaultValue="planning" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="planning">週間計画生成</TabsTrigger>
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

              <Button
                onClick={generateWeeklyPlan}
                disabled={isGenerating}
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
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  週間計画結果
                </CardTitle>
                <CardDescription>
                  {weeklyPlan.week_start_date}週の計画が生成されました
                </CardDescription>
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
                          <Badge variant="outline">
                            {plan.suggested_day}
                          </Badge>
                          <Badge variant="outline">
                            {plan.suggested_time_slot}
                          </Badge>
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
    </div>
  );
}
