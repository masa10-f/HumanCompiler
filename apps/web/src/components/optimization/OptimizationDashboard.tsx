'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { optimizationApi } from '@/lib/api';
import type {
  OptimizationRequest,
  OptimizationResponse,
  OptimizationUIState,
  WeeklyConstraints,
  TimeSlotConfig
} from '@/types/optimization';
import { RotateCcw, Clock, Target } from 'lucide-react';
import ExecutionPanel from './ExecutionPanel';
import ConstraintsForm from './ConstraintsForm';
import TimeSlotEditor from './TimeSlotEditor';
import ResultsDisplay from './ResultsDisplay';
import { DEFAULT_OPTIMIZATION_PRESETS as PRESETS } from '@/types/optimization';

interface OptimizationDashboardProps {
  weekStartDate?: string;
  onOptimizationComplete?: (result: OptimizationResponse) => void;
}

export default function OptimizationDashboard({
  weekStartDate,
  onOptimizationComplete
}: OptimizationDashboardProps) {
  const { toast } = useToast();

  // Get current Monday as default week start
  const getDefaultWeekStart = () => {
    if (weekStartDate) return weekStartDate;
    const today = new Date();
    const monday = new Date(today);
    const dayOfWeek = today.getDay() || 7; // Sunday = 0, make it 7
    monday.setDate(today.getDate() - (dayOfWeek - 1));
    return monday.toISOString().split('T')[0];
  };

  const [uiState, setUIState] = useState<OptimizationUIState>({
    isExecuting: false,
    currentStage: null,
    progress: 0,
    constraints: PRESETS[0]?.constraints || {
      total_capacity_hours: 40,
      daily_max_hours: 8,
      deep_work_blocks: 2,
      meeting_buffer_hours: 4,
    },
    timeSlots: PRESETS[0]?.timeSlots || [],
    results: null,
    history: [],
    error: null,
  });

  const [userPrompt, setUserPrompt] = useState('');

  const [currentWeekStart, setCurrentWeekStart] = useState(getDefaultWeekStart());
  const [selectedPreset, setSelectedPreset] = useState(0);

  const handleExecuteOptimization = useCallback(async () => {
    if (!currentWeekStart) {
      toast({
        title: 'エラー',
        description: '週の開始日が設定されていません',
        variant: 'destructive',
      });
      return;
    }

    try {
      setUIState(prev => ({
        ...prev,
        isExecuting: true,
        currentStage: 'initialization',
        progress: 0,
        error: null,
      }));

      const request: OptimizationRequest = {
        week_start_date: currentWeekStart,
        constraints: uiState.constraints,
        selected_recurring_task_ids: [],
        daily_time_slots: uiState.timeSlots,
        enable_caching: true,
        optimization_timeout_seconds: 30,
        fallback_on_failure: true,
        preferences: {},
        user_prompt: userPrompt.trim() || undefined,
      };

      // Simulate progress updates during execution
      const progressStages = [
        { stage: 'initialization', progress: 10 },
        { stage: 'task_selection', progress: 40 },
        { stage: 'time_optimization', progress: 80 },
        { stage: 'result_integration', progress: 95 },
      ];

      // Update progress through stages
      for (const stageUpdate of progressStages) {
        setUIState(prev => ({
          ...prev,
          currentStage: stageUpdate.stage as NonNullable<OptimizationUIState['currentStage']>,
          progress: stageUpdate.progress,
        }));
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate processing time
      }

      const response = await optimizationApi.executePipeline(request);

      setUIState(prev => ({
        ...prev,
        isExecuting: false,
        currentStage: 'completed',
        progress: 100,
        results: response,
        history: [response, ...prev.history.slice(0, 9)], // Keep last 10 results
      }));

      toast({
        title: 'ハイブリッド最適化完了',
        description: response.success
          ? `${response.total_optimized_hours.toFixed(1)}時間の最適化スケジュールを生成しました`
          : '最適化は部分的に完了しました。詳細を確認してください。',
        variant: response.success ? 'default' : 'destructive',
      });

      onOptimizationComplete?.(response);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '予期しないエラーが発生しました';

      setUIState(prev => ({
        ...prev,
        isExecuting: false,
        currentStage: null,
        progress: 0,
        error: errorMessage,
      }));

      toast({
        title: '最適化エラー',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [currentWeekStart, uiState.constraints, uiState.timeSlots, userPrompt, toast, onOptimizationComplete]);

  const handleClearCache = useCallback(async () => {
    try {
      if (currentWeekStart) {
        await optimizationApi.clearCache(currentWeekStart);
        toast({
          title: 'キャッシュクリア完了',
          description: `週 ${currentWeekStart} のキャッシュをクリアしました`,
        });
      }
    } catch (error) {
      toast({
        title: 'キャッシュクリアエラー',
        description: error instanceof Error ? error.message : 'キャッシュクリアに失敗しました',
        variant: 'destructive',
      });
    }
  }, [currentWeekStart, toast]);

  const handlePresetChange = useCallback((presetIndex: number) => {
    const preset = PRESETS[presetIndex];
    if (preset) {
      setSelectedPreset(presetIndex);
      setUIState(prev => ({
        ...prev,
        constraints: preset.constraints,
        timeSlots: preset.timeSlots,
      }));
      toast({
        title: 'プリセット適用',
        description: `${preset.name} の設定を適用しました`,
      });
    }
  }, [toast]);

  const handleConstraintsChange = useCallback((newConstraints: WeeklyConstraints) => {
    setUIState(prev => ({
      ...prev,
      constraints: newConstraints,
    }));
    setSelectedPreset(-1); // Clear preset selection when manually changed
  }, []);

  const handleTimeSlotsChange = useCallback((newTimeSlots: TimeSlotConfig[]) => {
    setUIState(prev => ({
      ...prev,
      timeSlots: newTimeSlots,
    }));
    setSelectedPreset(-1); // Clear preset selection when manually changed
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">ハイブリッド最適化パイプライン</h1>
          <p className="text-gray-500 mt-1">
            GPT-5 + OR-Tools による週間タスク計画・日次スケジュール最適化
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            {currentWeekStart}
          </Badge>
        </div>
      </div>

      {/* Week Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            最適化対象週
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <input
              type="date"
              value={currentWeekStart}
              onChange={(e) => setCurrentWeekStart(e.target.value)}
              className="px-3 py-2 border rounded-md"
              disabled={uiState.isExecuting}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              disabled={uiState.isExecuting}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              キャッシュクリア
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>最適化設定</CardTitle>
              <CardDescription>
                制約条件と時間スロットを設定してください
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="user-prompt">優先度調整の指示 (任意)</Label>
                <Textarea
                  id="user-prompt"
                  placeholder="この週は特定のタスクを優先したい場合は、ここに指示を入力してください。例: 「この週は特にリサーチタスクを優先して取り組みたい」"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  disabled={uiState.isExecuting}
                  rows={3}
                  className="resize-none"
                />
                <div className="text-xs text-gray-500">
                  ユーザープロンプトはAIがタスクの優先度を決定する際に考慮されます
                </div>
              </div>

              <Tabs defaultValue="presets" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="presets">プリセット</TabsTrigger>
                  <TabsTrigger value="constraints">制約条件</TabsTrigger>
                  <TabsTrigger value="timeslots">時間スロット</TabsTrigger>
                </TabsList>

                <TabsContent value="presets">
                  <div className="space-y-2">
                    {PRESETS.map((preset, index) => (
                      <Button
                        key={index}
                        variant={selectedPreset === index ? "default" : "outline"}
                        className="w-full text-left justify-start h-auto p-3"
                        onClick={() => handlePresetChange(index)}
                        disabled={uiState.isExecuting}
                      >
                        <div>
                          <div className="font-medium">{preset.name}</div>
                          <div className="text-xs text-gray-500">
                            {preset.description}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="constraints">
                  <ConstraintsForm
                    constraints={uiState.constraints}
                    onChange={handleConstraintsChange}
                    disabled={uiState.isExecuting}
                  />
                </TabsContent>

                <TabsContent value="timeslots">
                  <TimeSlotEditor
                    timeSlots={uiState.timeSlots}
                    onChange={handleTimeSlotsChange}
                    disabled={uiState.isExecuting}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Execution Panel */}
          <ExecutionPanel
            isExecuting={uiState.isExecuting}
            currentStage={uiState.currentStage}
            progress={uiState.progress}
            error={uiState.error}
            onExecute={handleExecuteOptimization}
          />
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          <ResultsDisplay
            results={uiState.results}
            history={uiState.history}
            isExecuting={uiState.isExecuting}
          />
        </div>
      </div>
    </div>
  );
}
