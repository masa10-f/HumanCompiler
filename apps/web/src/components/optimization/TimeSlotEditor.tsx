'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Clock, Zap, BookOpen, Briefcase } from 'lucide-react';
import type { TimeSlotConfig } from '@/types/optimization';

interface TimeSlotEditorProps {
  timeSlots: TimeSlotConfig[];
  onChange: (timeSlots: TimeSlotConfig[]) => void;
  disabled?: boolean;
}

const SLOT_KIND_CONFIG = {
  light_work: {
    label: 'ライトワーク',
    icon: Briefcase,
    color: 'bg-blue-500',
    description: '軽めの作業・事務処理',
  },
  focused_work: {
    label: '集中作業',
    icon: Zap,
    color: 'bg-purple-500',
    description: 'ディープワーク・重要タスク',
  },
  study: {
    label: '学習',
    icon: BookOpen,
    color: 'bg-green-500',
    description: '勉強・スキルアップ',
  },
} as const;

export default function TimeSlotEditor({
  timeSlots,
  onChange,
  disabled = false,
}: TimeSlotEditorProps) {
  const [newSlot, setNewSlot] = useState<TimeSlotConfig>({
    start: '09:00',
    end: '12:00',
    kind: 'light_work',
    capacity_hours: 3.0,
  });

  const addTimeSlot = useCallback(() => {
    // Validate new slot
    const startTime = new Date(`2000-01-01T${newSlot.start}:00`);
    const endTime = new Date(`2000-01-01T${newSlot.end}:00`);

    if (startTime >= endTime) {
      // Invalid time range
      return;
    }

    const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    const updatedSlot: TimeSlotConfig = {
      ...newSlot,
      capacity_hours: newSlot.capacity_hours || duration,
    };

    onChange([...timeSlots, updatedSlot]);

    // Reset form
    setNewSlot({
      start: '09:00',
      end: '12:00',
      kind: 'light_work',
      capacity_hours: 3.0,
    });
  }, [timeSlots, newSlot, onChange]);

  const removeTimeSlot = useCallback((index: number) => {
    onChange(timeSlots.filter((_, i) => i !== index));
  }, [timeSlots, onChange]);

  const updateTimeSlot = useCallback((index: number, updates: Partial<TimeSlotConfig>) => {
    const updatedSlots = timeSlots.map((slot, i) =>
      i === index ? { ...slot, ...updates } : slot
    );
    onChange(updatedSlots);
  }, [timeSlots, onChange]);

  const getTotalCapacity = () => {
    return timeSlots.reduce((total, slot) => total + (slot.capacity_hours || 0), 0);
  };

  const getSlotDuration = (slot: TimeSlotConfig) => {
    const startTime = new Date(`2000-01-01T${slot.start}:00`);
    const endTime = new Date(`2000-01-01T${slot.end}:00`);
    return (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  };

  return (
    <div className="space-y-4">
      {/* Current Time Slots */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">設定済み時間スロット</h4>
          <Badge variant="outline">
            <Clock className="w-3 h-3 mr-1" />
            合計 {getTotalCapacity().toFixed(1)}h
          </Badge>
        </div>

        {timeSlots.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-gray-500">
              時間スロットが設定されていません
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {timeSlots.map((slot, index) => {
              const config = SLOT_KIND_CONFIG[slot.kind];
              const Icon = config.icon;
              const duration = getSlotDuration(slot);

              return (
                <Card key={index}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full ${config.color} flex items-center justify-center text-white`}>
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {/* Start Time */}
                        <div>
                          <Label className="text-xs text-gray-500">開始</Label>
                          <Input
                            type="time"
                            value={slot.start}
                            onChange={(e) => updateTimeSlot(index, { start: e.target.value })}
                            disabled={disabled}
                            className="text-sm"
                          />
                        </div>

                        {/* End Time */}
                        <div>
                          <Label className="text-xs text-gray-500">終了</Label>
                          <Input
                            type="time"
                            value={slot.end}
                            onChange={(e) => updateTimeSlot(index, { end: e.target.value })}
                            disabled={disabled}
                            className="text-sm"
                          />
                        </div>

                        {/* Kind */}
                        <div>
                          <Label className="text-xs text-gray-500">種類</Label>
                          <Select
                            value={slot.kind}
                            onValueChange={(value: 'light_work' | 'focused_work' | 'study') =>
                              updateTimeSlot(index, { kind: value })
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(SLOT_KIND_CONFIG).map(([key, config]) => (
                                <SelectItem key={key} value={key}>
                                  {config.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Capacity */}
                        <div>
                          <Label className="text-xs text-gray-500">容量(h)</Label>
                          <Input
                            type="number"
                            value={slot.capacity_hours || duration}
                            onChange={(e) => updateTimeSlot(index, {
                              capacity_hours: parseFloat(e.target.value) || duration
                            })}
                            disabled={disabled}
                            min={0.5}
                            max={duration}
                            step={0.5}
                            className="text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeTimeSlot(index)}
                          disabled={disabled}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <div className="text-xs text-gray-500 text-right">
                          {duration.toFixed(1)}h<br />
                          <span className="text-xs">{config.label}</span>
                        </div>
                      </div>
                    </div>

                    {/* Duration vs Capacity Warning */}
                    {(slot.capacity_hours || 0) > duration && (
                      <div className="mt-2 text-xs text-amber-600">
                        ⚠️ 容量が実際の時間幅を超えています ({duration.toFixed(1)}h利用可能)
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Add New Time Slot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="w-5 h-5" />
            新しい時間スロットを追加
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {/* Start Time */}
            <div>
              <Label htmlFor="new-start">開始時刻</Label>
              <Input
                id="new-start"
                type="time"
                value={newSlot.start}
                onChange={(e) => setNewSlot(prev => ({ ...prev, start: e.target.value }))}
                disabled={disabled}
              />
            </div>

            {/* End Time */}
            <div>
              <Label htmlFor="new-end">終了時刻</Label>
              <Input
                id="new-end"
                type="time"
                value={newSlot.end}
                onChange={(e) => setNewSlot(prev => ({ ...prev, end: e.target.value }))}
                disabled={disabled}
              />
            </div>

            {/* Kind */}
            <div>
              <Label htmlFor="new-kind">スロット種類</Label>
              <Select
                value={newSlot.kind}
                onValueChange={(value: 'light_work' | 'focused_work' | 'study') =>
                  setNewSlot(prev => ({ ...prev, kind: value }))
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SLOT_KIND_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <config.icon className="w-4 h-4" />
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Capacity Hours */}
            <div>
              <Label htmlFor="new-capacity">容量時間</Label>
              <Input
                id="new-capacity"
                type="number"
                value={newSlot.capacity_hours}
                onChange={(e) => setNewSlot(prev => ({
                  ...prev,
                  capacity_hours: parseFloat(e.target.value) || 0
                }))}
                disabled={disabled}
                min={0.5}
                max={12}
                step={0.5}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              選択種類: {SLOT_KIND_CONFIG[newSlot.kind].description}
            </div>
            <Button onClick={addTimeSlot} disabled={disabled}>
              <Plus className="w-4 h-4 mr-2" />
              スロット追加
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Time Slots Summary */}
      <Card className="bg-gray-50 border-gray-200">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-600">総スロット数:</span>
              <span className="font-medium ml-2">{timeSlots.length}個</span>
            </div>
            <div>
              <span className="text-gray-600">総容量時間:</span>
              <span className="font-medium ml-2">{getTotalCapacity().toFixed(1)}h</span>
            </div>
            <div>
              <span className="text-gray-600">集中作業:</span>
              <span className="font-medium ml-2">
                {timeSlots.filter(s => s.kind === 'focused_work').length}スロット
              </span>
            </div>
            <div>
              <span className="text-gray-600">学習時間:</span>
              <span className="font-medium ml-2">
                {timeSlots
                  .filter(s => s.kind === 'study')
                  .reduce((total, slot) => total + (slot.capacity_hours || 0), 0)
                  .toFixed(1)}h
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
