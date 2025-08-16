'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface ExecutionPanelProps {
  isExecuting: boolean;
  currentStage: 'initialization' | 'task_selection' | 'time_optimization' | 'result_integration' | 'completed' | null;
  progress: number;
  error: string | null;
  onExecute: () => void;
}

const STAGE_CONFIG = {
  initialization: {
    label: '初期化',
    description: '最適化パイプラインを初期化中',
    icon: '🔄',
    color: 'bg-blue-500',
  },
  task_selection: {
    label: 'GPT-5 タスク選択',
    description: 'AI がタスクを分析・選択中',
    icon: '🤖',
    color: 'bg-purple-500',
  },
  time_optimization: {
    label: 'OR-Tools 最適化',
    description: '制約ソルバが時間配分を最適化中',
    icon: '⚙️',
    color: 'bg-orange-500',
  },
  result_integration: {
    label: '結果統合',
    description: '週間計画と日次最適化を統合中',
    icon: '📋',
    color: 'bg-green-500',
  },
  completed: {
    label: '完了',
    description: 'ハイブリッド最適化が完了しました',
    icon: '✅',
    color: 'bg-green-600',
  },
};

export default function ExecutionPanel({
  isExecuting,
  currentStage,
  progress,
  error,
  onExecute,
}: ExecutionPanelProps) {
  const currentStageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="w-5 h-5" />
          パイプライン実行
        </CardTitle>
        <CardDescription>
          3段階のハイブリッド最適化パイプラインを実行します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Execution Button */}
        <Button
          onClick={onExecute}
          disabled={isExecuting}
          className="w-full"
          size="lg"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              最適化実行中...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              ハイブリッド最適化を実行
            </>
          )}
        </Button>

        {/* Current Stage Display */}
        {isExecuting && currentStageConfig && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full ${currentStageConfig.color} flex items-center justify-center text-white text-sm font-bold`}>
                {currentStageConfig.icon}
              </div>
              <div>
                <div className="font-medium">{currentStageConfig.label}</div>
                <div className="text-sm text-gray-500">
                  {currentStageConfig.description}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>進行状況</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </div>
        )}

        {/* Stage Overview */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">実行段階</h4>
          <div className="space-y-2">
            {Object.entries(STAGE_CONFIG)
              .slice(0, 4) // Exclude 'completed'
              .map(([key, config], index) => {
                const isActive = currentStage === key;
                const isCompleted = currentStage === 'completed' ||
                  (currentStage && Object.keys(STAGE_CONFIG).indexOf(currentStage) > index);

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-50 border border-blue-200'
                        : isCompleted
                        ? 'bg-green-50'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-center w-6 h-6">
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : isActive ? (
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-gray-300" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{config.label}</div>
                      <div className="text-xs text-gray-500">{config.description}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
            <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-red-800">実行エラー</div>
              <div className="text-sm text-red-600 mt-1">{error}</div>
            </div>
          </div>
        )}

        {/* Success Display */}
        {currentStage === 'completed' && !error && (
          <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-green-800">最適化完了</div>
              <div className="text-sm text-green-600 mt-1">
                ハイブリッド最適化パイプラインが正常に完了しました
              </div>
            </div>
          </div>
        )}

        {/* Pipeline Info */}
        <div className="p-3 bg-gray-50 rounded-md">
          <div className="text-sm text-gray-700">
            <div className="font-medium mb-1">パイプライン仕様</div>
            <ul className="space-y-1 text-xs">
              <li>• タイムアウト: 30秒</li>
              <li>• フォールバック機能: 有効</li>
              <li>• 中間結果キャッシュ: 有効</li>
              <li>• GPT-5 + OR-Tools CP-SAT統合</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
