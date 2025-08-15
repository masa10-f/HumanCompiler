'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  BarChart3,
  Target,
  Zap,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingUp,
  Calendar,
  Brain,
  Settings,
  History
} from 'lucide-react';
import type { OptimizationResponse } from '@/types/optimization';

interface ResultsDisplayProps {
  results: OptimizationResponse | null;
  history: OptimizationResponse[];
  isExecuting: boolean;
}

export default function ResultsDisplay({
  results,
  history,
  isExecuting,
}: ResultsDisplayProps) {
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);

  const displayedResults = selectedHistoryIndex !== null ? history[selectedHistoryIndex] : results;

  if (isExecuting) {
    return (
      <Card className="h-full">
        <CardContent className="pt-6 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">ハイブリッド最適化を実行中...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!displayedResults) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>最適化結果</CardTitle>
          <CardDescription>
            最適化を実行すると、ここに結果が表示されます
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <BarChart3 className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500">
              左パネルから最適化を実行してください
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {displayedResults.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                最適化結果
              </CardTitle>
              <CardDescription>
                週 {displayedResults.week_start_date} のハイブリッド最適化
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={displayedResults.success ? "default" : "destructive"}
                className="capitalize"
              >
                {displayedResults.status}
              </Badge>
              <Badge variant="outline">
                {new Date(displayedResults.generated_at).toLocaleDateString('ja-JP')}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {displayedResults.total_optimized_hours.toFixed(1)}h
              </div>
              <div className="text-sm text-gray-500">総最適化時間</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {(displayedResults.capacity_utilization * 100).toFixed(0)}%
              </div>
              <div className="text-sm text-gray-500">容量利用率</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {(displayedResults.consistency_score * 100).toFixed(0)}%
              </div>
              <div className="text-sm text-gray-500">一貫性スコア</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {displayedResults.daily_optimizations.length}
              </div>
              <div className="text-sm text-gray-500">最適化日数</div>
            </div>
          </div>

          {/* Capacity Utilization Progress */}
          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-sm">
              <span>容量利用率</span>
              <span>{(displayedResults.capacity_utilization * 100).toFixed(1)}%</span>
            </div>
            <Progress value={displayedResults.capacity_utilization * 100} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Main Results Tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">概要</TabsTrigger>
              <TabsTrigger value="weekly">週間計画</TabsTrigger>
              <TabsTrigger value="daily">日次最適化</TabsTrigger>
              <TabsTrigger value="insights">インサイト</TabsTrigger>
              <TabsTrigger value="history">履歴</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Pipeline Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="w-5 h-5" />
                      パイプライン実行指標
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">総実行時間</span>
                        <span className="font-medium">
                          {displayedResults.pipeline_metrics.total_duration_seconds?.toFixed(2) || 'N/A'}秒
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">OR-Tools処理時間</span>
                        <span className="font-medium">
                          {displayedResults.pipeline_metrics.ortools_solve_time?.toFixed(2) || 'N/A'}秒
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">処理タスク数</span>
                        <span className="font-medium">
                          {displayedResults.pipeline_metrics.tasks_processed || 0}個
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">最適化効率</span>
                        <span className="font-medium">
                          {((displayedResults.pipeline_metrics.optimization_efficiency || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Performance Analysis */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      パフォーマンス分析
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">パイプライン効率</span>
                        <Badge variant="outline">
                          {displayedResults.performance_analysis?.pipeline_efficiency || 'medium'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">制約満足度</span>
                        <Badge variant="outline">
                          {displayedResults.performance_analysis?.constraint_satisfaction || 'partial'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">スケーラビリティ</span>
                        <span className="font-medium">
                          {((displayedResults.performance_analysis?.scalability_score || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Stage Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    実行段階詳細
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {displayedResults.stage_results?.map((stage, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                        <div className="flex items-center justify-center w-8 h-8">
                          {stage.success ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium capitalize">
                            {stage.stage.replace('_', ' ')}
                          </div>
                          <div className="text-sm text-gray-500">
                            実行時間: {stage.duration_seconds.toFixed(2)}秒
                          </div>
                        </div>
                        <div className="text-right">
                          {stage.errors?.length > 0 && (
                            <Badge variant="destructive" className="mb-1">
                              エラー: {stage.errors.length}
                            </Badge>
                          )}
                          {stage.warnings?.length > 0 && (
                            <Badge variant="secondary">
                              警告: {stage.warnings.length}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Weekly Planning Tab */}
            <TabsContent value="weekly" className="space-y-4">
              {displayedResults.weekly_solver_response ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="w-5 h-5" />
                        GPT-5 選択タスク
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {displayedResults.weekly_solver_response.selected_tasks.map((task, index) => (
                          <div key={index} className="border rounded-lg p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="font-medium">{task.task_title}</div>
                                <div className="text-sm text-gray-500 mt-1">
                                  {task.rationale}
                                </div>
                              </div>
                              <div className="text-right ml-4">
                                <Badge variant="outline">
                                  優先度: {task.priority}
                                </Badge>
                                <div className="text-sm text-gray-500 mt-1">
                                  {task.estimated_hours}時間
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Project Allocations */}
                  <Card>
                    <CardHeader>
                      <CardTitle>プロジェクト配分</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {displayedResults.weekly_solver_response.project_allocations.map((alloc, index) => (
                          <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                            <div>
                              <div className="font-medium">{alloc.project_title}</div>
                              <div className="text-sm text-gray-500">
                                優先度重み: {(alloc.priority_weight * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium">
                                {alloc.target_hours.toFixed(1)}h / {alloc.max_hours.toFixed(1)}h
                              </div>
                              <div className="text-sm text-gray-500">
                                目標 / 上限
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500">週間計画データが利用できません</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Daily Optimization Tab */}
            <TabsContent value="daily" className="space-y-4">
              <div className="grid gap-4">
                {displayedResults.daily_optimizations.map((day, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Calendar className="w-5 h-5" />
                          {new Date(day.date).toLocaleDateString('ja-JP', {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                          })}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={day.optimization_status === 'OPTIMAL' ? 'default' : 'secondary'}
                          >
                            {day.optimization_status}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {day.solve_time_seconds.toFixed(2)}秒
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <span className="text-sm text-gray-500">スケジュール済み時間</span>
                          <div className="font-medium">
                            {day.total_scheduled_hours.toFixed(1)}時間
                          </div>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">割り当て数</span>
                          <div className="font-medium">{day.assignments.length}件</div>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">未スケジュール</span>
                          <div className="font-medium">{day.unscheduled_tasks.length}件</div>
                        </div>
                      </div>

                      {day.assignments.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-medium mb-2">タスク割り当て</h4>
                          <div className="space-y-2">
                            {day.assignments.map((assignment, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                <span className="text-sm">タスク {assignment.task_id}</span>
                                <span className="text-sm font-medium">
                                  {assignment.start_time} ({assignment.duration_hours.toFixed(1)}h)
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {day.unscheduled_tasks.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-medium mb-2 text-amber-600">未スケジュールタスク</h4>
                          <div className="text-sm text-amber-700">
                            {day.unscheduled_tasks.join(', ')}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Insights Tab */}
            <TabsContent value="insights" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    最適化インサイト
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {displayedResults.optimization_insights.length > 0 ? (
                    <div className="space-y-3">
                      {displayedResults.optimization_insights.map((insight, index) => (
                        <div key={index} className="p-3 border-l-4 border-blue-500 bg-blue-50">
                          <p className="text-sm">{insight}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">
                      インサイトが生成されませんでした
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5" />
                    最適化履歴 ({history.length}件)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {history.length > 0 ? (
                    <div className="space-y-3">
                      {history.map((item, index) => (
                        <div
                          key={index}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedHistoryIndex === index
                              ? 'border-blue-500 bg-blue-50'
                              : 'hover:border-gray-300'
                          }`}
                          onClick={() => setSelectedHistoryIndex(
                            selectedHistoryIndex === index ? null : index
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">
                                週 {item.week_start_date}
                              </div>
                              <div className="text-sm text-gray-500">
                                {new Date(item.generated_at).toLocaleDateString('ja-JP', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={item.success ? 'default' : 'destructive'}>
                                {item.status}
                              </Badge>
                              <span className="text-sm text-gray-500">
                                {item.total_optimized_hours.toFixed(1)}h
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">
                      履歴がありません
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
