'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Project } from '@/types/project';

interface ProjectAllocationSettingsProps {
  projects: Project[];
  allocations: Record<string, number>;
  onAllocationsChange: (allocations: Record<string, number>) => void;
  disabled?: boolean;
}

export function ProjectAllocationSettings({
  projects,
  allocations,
  onAllocationsChange,
  disabled = false,
}: ProjectAllocationSettingsProps) {
  const [localAllocations, setLocalAllocations] = useState<Record<string, number>>(allocations);
  const [totalPercentage, setTotalPercentage] = useState(0);

  // Initialize allocations for all projects
  useEffect(() => {
    const initialAllocations: Record<string, number> = {};
    projects.forEach((project) => {
      initialAllocations[project.id] = allocations[project.id] || 0;
    });
    setLocalAllocations(initialAllocations);
  }, [projects, allocations]);

  // Calculate total percentage
  useEffect(() => {
    const total = Object.values(localAllocations).reduce((sum, value) => sum + value, 0);
    setTotalPercentage(total);
  }, [localAllocations]);

  const handleAllocationChange = (projectId: string, value: number) => {
    const newAllocations = { ...localAllocations, [projectId]: value };
    setLocalAllocations(newAllocations);
    onAllocationsChange(newAllocations);
  };

  const autoBalance = () => {
    if (projects.length === 0) return;

    const equalAllocation = Math.floor(100 / projects.length);
    const remainder = 100 - equalAllocation * projects.length;

    const newAllocations: Record<string, number> = {};
    projects.forEach((project, index) => {
      // Add remainder to first project to ensure 100% total
      newAllocations[project.id] = equalAllocation + (index === 0 ? remainder : 0);
    });

    setLocalAllocations(newAllocations);
    onAllocationsChange(newAllocations);
  };

  const isValidAllocation = totalPercentage === 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">プロジェクト配分設定</CardTitle>
        <CardDescription>
          各プロジェクトに作業時間を配分します（合計100%になるように設定）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total percentage indicator */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium">合計配分</span>
          <Badge variant={isValidAllocation ? "default" : "destructive"}>
            {totalPercentage}%
          </Badge>
        </div>

        {!isValidAllocation && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              配分の合計を100%にしてください（現在: {totalPercentage}%）
            </AlertDescription>
          </Alert>
        )}

        {projects.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              プロジェクトがありません。先にプロジェクトを作成してください。
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Auto-balance button */}
            <button
              onClick={autoBalance}
              disabled={disabled}
              className="w-full px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              均等に配分
            </button>

            {/* Project allocation sliders */}
            <div className="space-y-4">
              {projects.map((project) => {
                const allocation = localAllocations[project.id] || 0;
                return (
                  <div key={project.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {project.title}
                      </Label>
                      <span className="text-sm font-semibold text-gray-600">
                        {allocation}%
                      </span>
                    </div>
                    <Slider
                      value={[allocation]}
                      onValueChange={(values: number[]) => handleAllocationChange(project.id, values[0] ?? 0)}
                      max={100}
                      step={5}
                      disabled={disabled}
                      className="w-full"
                    />
                    {project.description && (
                      <p className="text-xs text-gray-500">{project.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Usage hint */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            プロジェクト配分を設定すると、週間スケジュールで選択したタスクから
            各プロジェクトの配分に応じてタスクが選択されます。
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
