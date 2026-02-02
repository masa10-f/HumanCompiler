'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Clock,
  Plus,
  Trash2,
  Edit,
  Star,
  Loader2,
  Copy,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { toast } from '@/hooks/use-toast';
import { slotTemplatesApi } from '@/lib/api';
import {
  slotKindLabels,
  getSlotKindLabel,
  getSlotKindColor,
  getDayOfWeekLabel,
  getDayOfWeekShortLabel,
  type SlotKind,
} from '@/constants/schedule';
import type {
  SlotTemplate,
  SlotTemplateCreate,
  SlotTemplateUpdate,
  DayOfWeekTemplates,
} from '@/types/ai-planning';
import { logger } from '@/lib/logger';

interface EditingSlot {
  start: string;
  end: string;
  kind: SlotKind;
}

interface TemplateFormData {
  name: string;
  day_of_week: number;
  slots: EditingSlot[];
  is_default: boolean;
}

const defaultSlot: EditingSlot = {
  start: '09:00',
  end: '12:00',
  kind: 'focused_work',
};

const defaultFormData: TemplateFormData = {
  name: '',
  day_of_week: 0,
  slots: [{ ...defaultSlot }],
  is_default: false,
};

export default function SlotTemplatesSettingsPage() {
  const { user, loading: authLoading } = useAuth();

  const [templatesByDay, setTemplatesByDay] = useState<DayOfWeekTemplates[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>('0');

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SlotTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<SlotTemplate | null>(null);

  // Form state
  const [formData, setFormData] = useState<TemplateFormData>(defaultFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Load templates
  const loadTemplates = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const data = await slotTemplatesApi.getByDay();
      setTemplatesByDay(data);
    } catch (error) {
      logger.error('Failed to load slot templates', { error });
      toast({
        title: 'エラー',
        description: 'テンプレートの読み込みに失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadTemplates();
    }
  }, [user, loadTemplates]);

  // Reset form
  const resetForm = (dayOfWeek?: number) => {
    setFormData({
      ...defaultFormData,
      day_of_week: dayOfWeek ?? parseInt(selectedDay, 10),
    });
  };

  // Open create dialog
  const handleOpenCreate = () => {
    resetForm();
    setIsCreateDialogOpen(true);
  };

  // Open edit dialog
  const handleOpenEdit = (template: SlotTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      day_of_week: template.day_of_week,
      slots: template.slots.map((slot) => ({
        start: slot.start,
        end: slot.end,
        kind: slot.kind as SlotKind,
      })),
      is_default: template.is_default,
    });
    setIsEditDialogOpen(true);
  };

  // Open delete dialog
  const handleOpenDelete = (template: SlotTemplate) => {
    setDeletingTemplate(template);
    setIsDeleteDialogOpen(true);
  };

  // Duplicate template
  const handleDuplicate = async (template: SlotTemplate) => {
    try {
      const newTemplate: SlotTemplateCreate = {
        name: `${template.name} (コピー)`,
        day_of_week: template.day_of_week,
        slots: template.slots,
        is_default: false,
      };
      await slotTemplatesApi.create(newTemplate);
      toast({
        title: '成功',
        description: 'テンプレートを複製しました',
      });
      loadTemplates();
    } catch (error) {
      logger.error('Failed to duplicate template', { error });
      toast({
        title: 'エラー',
        description: 'テンプレートの複製に失敗しました',
        variant: 'destructive',
      });
    }
  };

  // Create template
  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'エラー',
        description: 'テンプレート名を入力してください',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const createData: SlotTemplateCreate = {
        name: formData.name,
        day_of_week: formData.day_of_week,
        slots: formData.slots,
        is_default: formData.is_default,
      };
      await slotTemplatesApi.create(createData);
      toast({
        title: '成功',
        description: 'テンプレートを作成しました',
      });
      setIsCreateDialogOpen(false);
      loadTemplates();
    } catch (error) {
      logger.error('Failed to create template', { error });
      toast({
        title: 'エラー',
        description: 'テンプレートの作成に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Update template
  const handleUpdate = async () => {
    if (!editingTemplate) return;

    if (!formData.name.trim()) {
      toast({
        title: 'エラー',
        description: 'テンプレート名を入力してください',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const updateData: SlotTemplateUpdate = {
        name: formData.name,
        day_of_week: formData.day_of_week,
        slots: formData.slots,
        is_default: formData.is_default,
      };
      await slotTemplatesApi.update(editingTemplate.id, updateData);
      toast({
        title: '成功',
        description: 'テンプレートを更新しました',
      });
      setIsEditDialogOpen(false);
      setEditingTemplate(null);
      loadTemplates();
    } catch (error) {
      logger.error('Failed to update template', { error });
      toast({
        title: 'エラー',
        description: 'テンプレートの更新に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete template
  const handleDelete = async () => {
    if (!deletingTemplate) return;

    try {
      await slotTemplatesApi.delete(deletingTemplate.id);
      toast({
        title: '成功',
        description: 'テンプレートを削除しました',
      });
      setIsDeleteDialogOpen(false);
      setDeletingTemplate(null);
      loadTemplates();
    } catch (error) {
      logger.error('Failed to delete template', { error });
      toast({
        title: 'エラー',
        description: 'テンプレートの削除に失敗しました',
        variant: 'destructive',
      });
    }
  };

  // Add slot to form
  const addSlot = () => {
    setFormData((prev) => ({
      ...prev,
      slots: [...prev.slots, { ...defaultSlot }],
    }));
  };

  // Remove slot from form
  const removeSlot = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      slots: prev.slots.filter((_, i) => i !== index),
    }));
  };

  // Update slot in form
  const updateSlot = (index: number, field: keyof EditingSlot, value: string) => {
    setFormData((prev) => ({
      ...prev,
      slots: prev.slots.map((slot, i) =>
        i === index ? { ...slot, [field]: value } : slot
      ),
    }));
  };

  // Get templates for selected day
  const currentDayTemplates = templatesByDay.find(
    (d) => d.day_of_week === parseInt(selectedDay, 10)
  );

  // Form content JSX (inlined to avoid re-mount issues)
  const formContent = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">テンプレート名</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="例: 平日の標準スケジュール"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="day_of_week">曜日</Label>
          <Select
            value={formData.day_of_week.toString()}
            onValueChange={(value) =>
              setFormData((prev) => ({ ...prev, day_of_week: parseInt(value, 10) }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <SelectItem key={day} value={day.toString()}>
                  {getDayOfWeekLabel(day)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_default"
          checked={formData.is_default}
          onCheckedChange={(checked) =>
            setFormData((prev) => ({ ...prev, is_default: checked }))
          }
        />
        <Label htmlFor="is_default">この曜日のデフォルトテンプレートとして設定</Label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>タイムスロット</Label>
          <Button variant="outline" size="sm" onClick={addSlot}>
            <Plus className="h-4 w-4 mr-1" />
            スロットを追加
          </Button>
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {formData.slots.map((slot, index) => (
            <div key={index} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
              <span className="text-sm text-muted-foreground w-6">{index + 1}.</span>
              <div className="flex-1 grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">開始</Label>
                  <Input
                    type="time"
                    value={slot.start}
                    onChange={(e) => updateSlot(index, 'start', e.target.value)}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">終了</Label>
                  <Input
                    type="time"
                    value={slot.end}
                    onChange={(e) => updateSlot(index, 'end', e.target.value)}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">種別</Label>
                  <Select
                    value={slot.kind}
                    onValueChange={(value) => updateSlot(index, 'kind', value)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(slotKindLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => removeSlot(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {formData.slots.length === 0 && (
            <div className="text-center py-4 text-muted-foreground text-sm">
              スロットがありません。「スロットを追加」をクリックして追加してください。
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/scheduling">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">スロットテンプレート設定</h1>
            <p className="text-muted-foreground">
              曜日ごとのスロットプリセットを管理します
            </p>
          </div>
        </div>

        {/* Day tabs */}
        <Tabs value={selectedDay} onValueChange={setSelectedDay} className="space-y-4">
          <TabsList className="grid grid-cols-7 w-full">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => {
              const dayData = templatesByDay.find((d) => d.day_of_week === day);
              const hasDefault = dayData?.default_template !== null;
              return (
                <TabsTrigger
                  key={day}
                  value={day.toString()}
                  className="relative"
                >
                  {getDayOfWeekShortLabel(day)}
                  {hasDefault && (
                    <Star className="h-3 w-3 absolute -top-1 -right-1 text-yellow-500 fill-yellow-500" />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <TabsContent key={day} value={day.toString()} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{getDayOfWeekLabel(day)}</h2>
                <Button onClick={handleOpenCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  テンプレートを作成
                </Button>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {currentDayTemplates?.templates.map((template) => (
                    <Card key={template.id} className="relative">
                      {template.is_default && (
                        <Badge
                          variant="secondary"
                          className="absolute -top-2 -right-2 bg-yellow-100 text-yellow-800"
                        >
                          <Star className="h-3 w-3 mr-1 fill-current" />
                          デフォルト
                        </Badge>
                      )}
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        <CardDescription>
                          {template.slots.length} スロット
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Slot preview */}
                        <div className="space-y-1">
                          {template.slots.slice(0, 3).map((slot, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span>
                                {slot.start} - {slot.end}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-xs ${getSlotKindColor(slot.kind)}`}
                              >
                                {getSlotKindLabel(slot.kind)}
                              </Badge>
                            </div>
                          ))}
                          {template.slots.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              ...他 {template.slots.length - 3} スロット
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleOpenEdit(template)}
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            編集
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDuplicate(template)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleOpenDelete(template)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {currentDayTemplates?.templates.length === 0 && (
                    <Card className="col-span-full">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-muted-foreground mb-4">
                          {getDayOfWeekLabel(day)}のテンプレートがありません
                        </p>
                        <Button variant="outline" onClick={handleOpenCreate}>
                          <Plus className="h-4 w-4 mr-2" />
                          テンプレートを作成
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>テンプレートを作成</DialogTitle>
            <DialogDescription>
              新しいスロットテンプレートを作成します
            </DialogDescription>
          </DialogHeader>
          {formContent}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>テンプレートを編集</DialogTitle>
            <DialogDescription>
              スロットテンプレートを編集します
            </DialogDescription>
          </DialogHeader>
          {formContent}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleUpdate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>テンプレートを削除</AlertDialogTitle>
            <AlertDialogDescription>
              「{deletingTemplate?.name}」を削除しますか？この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
