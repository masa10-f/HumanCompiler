'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, RefreshCw, Save, XCircle } from 'lucide-react';

import { AppHeader } from '@/components/layout/app-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { triageApi } from '@/lib/api';
import type { TriageItem, TriageRecommendation, TriageRun } from '@/types/triage';
import { taskPriorityLabels, workTypeLabels } from '@/types/task';

type TriageTab = 'all' | 'keep' | 'cancel' | 'history';

const effectiveAction = (item: TriageItem): TriageRecommendation =>
  item.user_override || item.recommendation;

const formatHours = (value: number | undefined) => `${(value || 0).toFixed(1)}h`;

export default function TriagePage() {
  const { user, loading: authLoading } = useAuth();
  const [run, setRun] = useState<TriageRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const cancelCandidates = useMemo(
    () =>
      (run?.items || []).filter(
        (item) => effectiveAction(item) === 'cancel' && !item.applied_at
      ),
    [run]
  );

  useEffect(() => {
    if (authLoading || !user) return;
    void loadLatestRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  useEffect(() => {
    setSelectedItemIds(cancelCandidates.map((item) => item.id));
  }, [cancelCandidates]);

  const loadLatestRun = async () => {
    setLoading(true);
    setError('');
    try {
      const latestRun = await triageApi.getLatestRun();
      setRun(latestRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トリアージrunの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const generateRun = async () => {
    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const newRun = await triageApi.createRun({});
      setRun(newRun);
      setSuccess('トリアージ候補を生成しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トリアージ候補の生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  };

  const overrideItem = async (item: TriageItem, userOverride: TriageRecommendation | null) => {
    if (!run) return;
    setError('');
    setSuccess('');
    try {
      const updatedRun = await triageApi.overrideItem(run.id, item.id, { user_override: userOverride });
      setRun(updatedRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上書きの保存に失敗しました');
    }
  };

  const applySelected = async () => {
    if (!run || selectedItemIds.length === 0) return;
    setApplying(true);
    setError('');
    setSuccess('');
    try {
      const result = await triageApi.applyRun(run.id, { item_ids: selectedItemIds });
      const refreshedRun = await triageApi.getRun(run.id);
      setRun(refreshedRun);
      setSuccess(
        `${result.applied_count}件をキャンセルしました。スキップ ${result.skipped_count}件、失敗 ${result.failed_count}件`
      );
      if (result.errors.length > 0) {
        setError(result.errors.join(' / '));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'トリアージ適用に失敗しました');
    } finally {
      setApplying(false);
    }
  };

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedItemIds((current) =>
      checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId)
    );
  };

  const renderTable = (items: TriageItem[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10"></TableHead>
          <TableHead>タスク</TableHead>
          <TableHead>分類</TableHead>
          <TableHead>残り</TableHead>
          <TableHead>優先度</TableHead>
          <TableHead>スコア</TableHead>
          <TableHead>判断</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const action = effectiveAction(item);
          const selectable = action === 'cancel' && !item.applied_at;
          return (
            <TableRow key={item.id}>
              <TableCell>
                {selectable && (
                  <Checkbox
                    checked={selectedItemIds.includes(item.id)}
                    onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                    aria-label={`${item.title}を適用対象にする`}
                  />
                )}
              </TableCell>
              <TableCell className="min-w-[240px]">
                <div className="font-medium">{item.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.reason_codes.slice(0, 3).map((reason) => (
                    <Badge key={reason} variant="secondary" className="text-[10px]">
                      {reason}
                    </Badge>
                  ))}
                </div>
                {item.ai_reason && (
                  <div className="mt-1 text-xs text-muted-foreground">{item.ai_reason}</div>
                )}
                {item.apply_error && (
                  <div className="mt-1 text-xs text-destructive">{item.apply_error}</div>
                )}
              </TableCell>
              <TableCell>
                <div>{item.bucket_title}</div>
                <div className="text-xs text-muted-foreground">
                  {item.item_type === 'quick_task' ? 'Quick Task' : workTypeLabels[item.work_type]}
                </div>
              </TableCell>
              <TableCell>{formatHours(item.remaining_hours)}</TableCell>
              <TableCell>{taskPriorityLabels[item.priority] || item.priority}</TableCell>
              <TableCell>
                <div>{item.final_score.toFixed(1)}</div>
                {item.ai_score_delta !== 0 && (
                  <div className="text-xs text-muted-foreground">
                    AI {item.ai_score_delta > 0 ? '+' : ''}{item.ai_score_delta.toFixed(1)}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {item.applied_at ? (
                  <Badge variant="outline">適用済み</Badge>
                ) : action === 'cancel' ? (
                  <Badge variant="destructive">外す</Badge>
                ) : (
                  <Badge>残す</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant={action === 'keep' ? 'default' : 'outline'}
                    disabled={Boolean(item.applied_at)}
                    onClick={() => overrideItem(item, 'keep')}
                  >
                    残す
                  </Button>
                  <Button
                    size="sm"
                    variant={action === 'cancel' ? 'destructive' : 'outline'}
                    disabled={Boolean(item.applied_at)}
                    onClick={() => overrideItem(item, 'cancel')}
                  >
                    外す
                  </Button>
                  {item.user_override && !item.applied_at && (
                    <Button size="sm" variant="ghost" onClick={() => overrideItem(item, null)}>
                      戻す
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
              対象はありません
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const itemsForTab = (tab: TriageTab): TriageItem[] => {
    if (!run) return [];
    if (tab === 'keep') {
      return run.items.filter((item) => effectiveAction(item) === 'keep' && !item.applied_at);
    }
    if (tab === 'cancel') {
      return run.items.filter((item) => effectiveAction(item) === 'cancel' && !item.applied_at);
    }
    if (tab === 'history') {
      return run.items.filter((item) => item.applied_at || item.apply_error);
    }
    return run.items;
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="triage" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">トリアージ</h1>
            {run && (
              <p className="mt-1 text-sm text-muted-foreground">
                {new Date(run.created_at).toLocaleString()} / {run.source === 'scheduled' ? '自動生成' : '手動生成'}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadLatestRun} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              更新
            </Button>
            <Button onClick={generateRun} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              候補生成
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mb-4">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !run ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <XCircle className="h-10 w-10 text-muted-foreground" />
              <div className="text-lg font-medium">トリアージrunはまだありません</div>
              <Button onClick={generateRun} disabled={generating}>
                候補生成
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">実効キャパシティ</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {formatHours(run.summary.effective_capacity_hours)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">残り総量</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {formatHours(run.summary.total_remaining_hours)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">残す量</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {formatHours(run.summary.kept_hours)}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">外す候補</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {formatHours(run.summary.cancel_candidate_hours)}
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                選択中: <span className="font-semibold">{selectedItemIds.length}</span> / {cancelCandidates.length}
              </div>
              <Button
                onClick={applySelected}
                disabled={applying || selectedItemIds.length === 0}
                variant="destructive"
              >
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                選択候補をキャンセル
              </Button>
            </div>

            <Tabs defaultValue="cancel">
              <TabsList>
                <TabsTrigger value="cancel">外す候補</TabsTrigger>
                <TabsTrigger value="keep">残す</TabsTrigger>
                <TabsTrigger value="all">すべて</TabsTrigger>
                <TabsTrigger value="history">履歴</TabsTrigger>
              </TabsList>
              <TabsContent value="cancel" className="mt-4">
                {renderTable(itemsForTab('cancel'))}
              </TabsContent>
              <TabsContent value="keep" className="mt-4">
                {renderTable(itemsForTab('keep'))}
              </TabsContent>
              <TabsContent value="all" className="mt-4">
                {renderTable(itemsForTab('all'))}
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                {renderTable(itemsForTab('history'))}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}
