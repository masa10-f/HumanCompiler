// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  CheckCircle,
  Clock,
  Loader2,
  Save,
  Target,
  TrendingUp,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useProjectOptions } from "@/hooks/use-project-query";
import { toast } from "@/hooks/use-toast";
import { reportsApi } from "@/lib/api";
import { getJSTDateString, isValidJSTDateInput } from "@/lib/date-utils";
import { getSelectableProjects } from "@/lib/project-filters";
import type { WeeklyReportResponse } from "@/types/reports";

export default function WeeklyReportPage() {
  const { user, loading: authLoading } = useAuth();
  const { data: projects = [] } = useProjectOptions({
    enabled: Boolean(user),
  });
  const selectableProjects = useMemo(
    () => getSelectableProjects(projects),
    [projects],
  );

  const [weekStartDate, setWeekStartDate] = useState(getJSTDateString);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [weeklyReport, setWeeklyReport] =
    useState<WeeklyReportResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const isWeekStartValid = isValidJSTDateInput(weekStartDate);
  const filteredProjectIds = selectedProjects.filter((projectId) =>
    selectableProjects.some((project) => project.id === projectId),
  );

  const handleProjectSelection = (projectId: string, checked: boolean) => {
    setSelectedProjects((current) =>
      checked
        ? [...current, projectId]
        : current.filter((id) => id !== projectId),
    );
  };

  const generateWeeklyReport = async () => {
    if (!isWeekStartValid) {
      toast({
        title: "日付エラー",
        description: "正しい日付形式（YYYY-MM-DD）で入力してください。",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsGenerating(true);
      const reportData = await reportsApi.generateWeeklyReport(
        weekStartDate,
        filteredProjectIds.length > 0 ? filteredProjectIds : undefined,
      );
      setWeeklyReport(reportData);
      toast({
        title: "週間作業報告を生成しました",
        description: `${reportData.work_summary.total_tasks_worked}個のタスクの報告書が生成されました`,
      });
    } catch (error) {
      toast({
        title: "報告書生成に失敗しました",
        description:
          error instanceof Error ? error.message : "不明なエラーが発生しました",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadReportAsMarkdown = () => {
    if (!weeklyReport) return;

    const filename = `weekly-report-${weeklyReport.week_start_date}.md`;
    const blob = new Blob([weeklyReport.markdown_report], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "ダウンロードが開始されました",
      description: `${filename}がダウンロードされました`,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="weekly-report" />

      <div className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-8 w-8 text-purple-600" />
            週間作業報告
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            指定した週の作業実績を分析し、報告書を自動生成します。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>報告条件</CardTitle>
            <CardDescription>
              開始日から7日間の作業ログを集計します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="report-week-start">報告対象週開始日</Label>
                <div className="flex gap-2">
                  <Input
                    id="report-week-start"
                    type="date"
                    value={weekStartDate}
                    onChange={(e) => setWeekStartDate(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWeekStartDate(getJSTDateString())}
                    className="whitespace-nowrap"
                  >
                    今日
                  </Button>
                </div>
                {weekStartDate && !isWeekStartValid && (
                  <p className="text-sm text-destructive">
                    ⚠️ 正しい日付形式で入力してください（YYYY-MM-DD）
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>対象プロジェクト (任意)</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {selectableProjects.map((project) => (
                  <div key={project.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`report-${project.id}`}
                      checked={selectedProjects.includes(project.id)}
                      onCheckedChange={(checked) =>
                        handleProjectSelection(project.id, checked === true)
                      }
                    />
                    <Label htmlFor={`report-${project.id}`} className="text-sm">
                      {project.title}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={generateWeeklyReport}
              disabled={isGenerating || !isWeekStartValid}
              className="w-full"
            >
              {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              週間作業報告を生成
            </Button>
          </CardContent>
        </Card>

        {weeklyReport && (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    週間作業報告結果
                  </CardTitle>
                  <CardDescription>
                    {weeklyReport.week_start_date} ～ {weeklyReport.week_end_date}
                    の報告書
                  </CardDescription>
                </div>
                <Button
                  onClick={downloadReportAsMarkdown}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  マークダウンをダウンロード
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryTile
                  icon={<Clock className="h-4 w-4 text-blue-600" />}
                  value={`${Math.round((weeklyReport.work_summary.total_actual_minutes / 60) * 10) / 10}h`}
                  label="総作業時間"
                />
                <SummaryTile
                  icon={<Target className="h-4 w-4 text-purple-600" />}
                  value={String(weeklyReport.work_summary.total_tasks_worked)}
                  label="作業タスク数"
                />
                <SummaryTile
                  icon={<CheckCircle className="h-4 w-4 text-green-600" />}
                  value={String(weeklyReport.work_summary.total_completed_tasks)}
                  label="完了タスク数"
                />
                <SummaryTile
                  icon={<TrendingUp className="h-4 w-4 text-orange-600" />}
                  value={`${Math.round(weeklyReport.work_summary.overall_completion_percentage * 10) / 10}%`}
                  label="完了率"
                />
              </div>

              <Separator />

              <div>
                <h2 className="text-lg font-semibold mb-3">
                  生成された報告書プレビュー
                </h2>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg max-h-96 overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-sm">
                    {weeklyReport.markdown_report}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
