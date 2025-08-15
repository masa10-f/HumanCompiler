'use client';

import React, { useState, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
// import { Slider } from '@/components/ui/slider'; // Not available, using range input instead
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Target, Focus, Calendar } from 'lucide-react';
import type { WeeklyConstraints } from '@/types/optimization';

interface ConstraintsFormProps {
  constraints: WeeklyConstraints;
  onChange: (constraints: WeeklyConstraints) => void;
  disabled?: boolean;
}

export default function ConstraintsForm({
  constraints,
  onChange,
  disabled = false,
}: ConstraintsFormProps) {
  const [localConstraints, setLocalConstraints] = useState(constraints);

  const updateConstraint = useCallback((key: keyof WeeklyConstraints, value: number) => {
    const newConstraints = { ...localConstraints, [key]: value };
    setLocalConstraints(newConstraints);
    onChange(newConstraints);
  }, [localConstraints, onChange]);

  return (
    <div className="space-y-6">
      {/* Total Capacity Hours */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <Label htmlFor="total-capacity" className="font-medium">
                週間総容量時間
              </Label>
              <Badge variant="secondary" className="ml-auto">
                {constraints.total_capacity_hours}時間
              </Badge>
            </div>
            <div className="space-y-2">
              <input
                type="range"
                id="total-capacity"
                min={10}
                max={80}
                step={1}
                value={constraints.total_capacity_hours}
                onChange={(e) => updateConstraint('total_capacity_hours', parseInt(e.target.value))}
                disabled={disabled}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>10時間</span>
                <span>40時間 (標準)</span>
                <span>80時間</span>
              </div>
            </div>
            <Input
              type="number"
              value={constraints.total_capacity_hours}
              onChange={(e) => updateConstraint('total_capacity_hours', parseInt(e.target.value) || 0)}
              disabled={disabled}
              min={10}
              max={80}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Daily Max Hours */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-green-600" />
              <Label htmlFor="daily-max" className="font-medium">
                日次最大時間
              </Label>
              <Badge variant="secondary" className="ml-auto">
                {constraints.daily_max_hours}時間/日
              </Badge>
            </div>
            <div className="space-y-2">
              <input
                type="range"
                id="daily-max"
                min={2}
                max={16}
                step={0.5}
                value={constraints.daily_max_hours}
                onChange={(e) => updateConstraint('daily_max_hours', parseFloat(e.target.value))}
                disabled={disabled}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>2時間</span>
                <span>8時間 (標準)</span>
                <span>16時間</span>
              </div>
            </div>
            <Input
              type="number"
              value={constraints.daily_max_hours}
              onChange={(e) => updateConstraint('daily_max_hours', parseFloat(e.target.value) || 0)}
              disabled={disabled}
              min={2}
              max={16}
              step={0.5}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Deep Work Blocks */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Focus className="w-4 h-4 text-purple-600" />
              <Label htmlFor="deep-work" className="font-medium">
                ディープワークブロック数
              </Label>
              <Badge variant="secondary" className="ml-auto">
                {constraints.deep_work_blocks}ブロック
              </Badge>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              集中作業に割り当てる時間ブロック数（1ブロック = 2-3時間）
            </div>
            <div className="space-y-2">
              <input
                type="range"
                id="deep-work"
                min={1}
                max={8}
                step={1}
                value={constraints.deep_work_blocks}
                onChange={(e) => updateConstraint('deep_work_blocks', parseInt(e.target.value))}
                disabled={disabled}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>1ブロック</span>
                <span>3ブロック (推奨)</span>
                <span>8ブロック</span>
              </div>
            </div>
            <Input
              type="number"
              value={constraints.deep_work_blocks}
              onChange={(e) => updateConstraint('deep_work_blocks', parseInt(e.target.value) || 0)}
              disabled={disabled}
              min={1}
              max={8}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Meeting Buffer Hours */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-orange-600" />
              <Label htmlFor="meeting-buffer" className="font-medium">
                ミーティングバッファ時間
              </Label>
              <Badge variant="secondary" className="ml-auto">
                {constraints.meeting_buffer_hours}時間
              </Badge>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              予定されていない会議や突発的な作業に備える時間
            </div>
            <div className="space-y-2">
              <input
                type="range"
                id="meeting-buffer"
                min={0}
                max={20}
                step={0.5}
                value={constraints.meeting_buffer_hours}
                onChange={(e) => updateConstraint('meeting_buffer_hours', parseFloat(e.target.value))}
                disabled={disabled}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0時間</span>
                <span>4時間 (推奨)</span>
                <span>20時間</span>
              </div>
            </div>
            <Input
              type="number"
              value={constraints.meeting_buffer_hours}
              onChange={(e) => updateConstraint('meeting_buffer_hours', parseFloat(e.target.value) || 0)}
              disabled={disabled}
              min={0}
              max={20}
              step={0.5}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Capacity Analysis */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <h4 className="font-medium text-blue-800">容量分析</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">実作業時間:</span>
                <span className="font-medium ml-2">
                  {Math.max(0, constraints.total_capacity_hours - constraints.meeting_buffer_hours).toFixed(1)}h
                </span>
              </div>
              <div>
                <span className="text-gray-600">日平均:</span>
                <span className="font-medium ml-2">
                  {(constraints.total_capacity_hours / 7).toFixed(1)}h/日
                </span>
              </div>
              <div>
                <span className="text-gray-600">ディープワーク:</span>
                <span className="font-medium ml-2">
                  {(constraints.deep_work_blocks * 2.5).toFixed(1)}h予定
                </span>
              </div>
              <div>
                <span className="text-gray-600">バッファ率:</span>
                <span className="font-medium ml-2">
                  {((constraints.meeting_buffer_hours / constraints.total_capacity_hours) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Validation Warnings */}
            {constraints.daily_max_hours * 7 < constraints.total_capacity_hours && (
              <div className="text-xs text-amber-600 mt-2">
                ⚠️ 日次最大時間の合計が週間総容量より小さいです
              </div>
            )}

            {constraints.meeting_buffer_hours >= constraints.total_capacity_hours * 0.5 && (
              <div className="text-xs text-amber-600 mt-2">
                ⚠️ ミーティングバッファが全体の50%を超えています
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
