// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { AgentScopeCatalog, AgentTokenCreate } from '@/types/agent-token';

const CUSTOM_PRESET = 'custom';
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;

interface AgentTokenCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: AgentScopeCatalog;
  onCreate: (data: AgentTokenCreate) => Promise<void>;
}

function sameScopes(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((scope) => b.includes(scope));
}

/**
 * Creates an agent token. Presets and scopes both come from the API's scope
 * catalog; the selected preset is derived from the checked scopes.
 */
export function AgentTokenCreateDialog({
  open,
  onOpenChange,
  catalog,
  onCreate,
}: AgentTokenCreateDialogProps) {
  const idPrefix = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);

  const selectedPreset =
    catalog.presets.find((preset) => sameScopes(preset.scopes, checked))?.key ??
    CUSTOM_PRESET;
  const canSubmit = name.trim() !== '' && checked.length > 0 && !isSubmitting;

  const reset = () => {
    setName('');
    setDescription('');
    setChecked([]);
    setHasError(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    // A late failure must not land on a form that was already closed and reset.
    if (!nextOpen && isSubmitting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handlePresetChange = (key: string) => {
    // Choosing "custom" keeps the current checks.
    const preset = catalog.presets.find((item) => item.key === key);
    if (preset) setChecked([...preset.scopes]);
  };

  const handleScopeChange = (scope: string, isChecked: boolean) => {
    setChecked((prev) =>
      isChecked ? [...prev, scope] : prev.filter((item) => item !== scope),
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const trimmedDescription = description.trim();
    const data: AgentTokenCreate = {
      name: name.trim(),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      scopes: catalog.scopes.map((info) => info.scope).filter((s) => checked.includes(s)),
    };
    setIsSubmitting(true);
    setHasError(false);
    try {
      await onCreate(data);
      reset();
      onOpenChange(false);
    } catch {
      setHasError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>エージェントトークンを作成</DialogTitle>
            <DialogDescription>
              エージェントに許可する操作（スコープ）を選びます。必要最小限にしてください。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-name`}>名前</Label>
            <Input
              id={`${idPrefix}-name`}
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="例: Research agent"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-description`}>説明（任意）</Label>
            <Textarea
              id={`${idPrefix}-description`}
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">プリセット</p>
            <RadioGroup
              value={selectedPreset}
              onValueChange={handlePresetChange}
              aria-label="プリセット"
            >
              {catalog.presets.map((preset) => (
                <div key={preset.key} className="flex items-start gap-2">
                  <RadioGroupItem
                    value={preset.key}
                    id={`${idPrefix}-preset-${preset.key}`}
                    className="mt-1"
                  />
                  <Label
                    htmlFor={`${idPrefix}-preset-${preset.key}`}
                    className="space-y-0.5 font-normal"
                  >
                    <span className="block font-medium">{preset.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {preset.description}
                    </span>
                  </Label>
                </div>
              ))}
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value={CUSTOM_PRESET}
                  id={`${idPrefix}-preset-${CUSTOM_PRESET}`}
                  className="mt-1"
                />
                <Label
                  htmlFor={`${idPrefix}-preset-${CUSTOM_PRESET}`}
                  className="space-y-0.5 font-normal"
                >
                  <span className="block font-medium">カスタム</span>
                  <span className="block text-xs text-muted-foreground">
                    スコープを個別に選びます。
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">スコープ</legend>
            {catalog.scopes.map((info) => {
              const id = `${idPrefix}-scope-${info.scope}`;
              return (
                <div key={info.scope} data-scope-row className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-1"
                    checked={checked.includes(info.scope)}
                    onCheckedChange={(value) =>
                      handleScopeChange(info.scope, value === true)
                    }
                  />
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={id} className="font-mono text-sm font-normal">
                        {info.scope}
                      </Label>
                      {info.broad && <Badge variant="warning">広い読み取り権限</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{info.description}</p>
                  </div>
                </div>
              );
            })}
          </fieldset>

          {hasError && (
            <p role="alert" className="text-sm text-destructive">
              エージェントトークンの作成に失敗しました
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              作成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
