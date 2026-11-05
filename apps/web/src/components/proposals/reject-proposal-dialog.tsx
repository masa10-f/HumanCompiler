// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  REJECT_CATEGORY_LABELS,
  type ProposalRejectCategory,
  type ProposalRejectRequest,
} from '@/types/proposal';

const CATEGORIES = Object.keys(REJECT_CATEGORY_LABELS) as ProposalRejectCategory[];

interface RejectProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True while the reject request is in flight. */
  pending: boolean;
  /** Message of the last failed attempt; the dialog stays open with its input. */
  error: string | null;
  onSubmit: (body: ProposalRejectRequest) => void;
}

export function RejectProposalDialog({
  open,
  onOpenChange,
  pending,
  error,
  onSubmit,
}: RejectProposalDialogProps) {
  const [category, setCategory] = useState<ProposalRejectCategory | ''>('');
  const [note, setNote] = useState('');

  // Drop the input once the dialog closes, however it was closed.
  useEffect(() => {
    if (!open) {
      setCategory('');
      setNote('');
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!pending) onOpenChange(next);
  };

  const handleSubmit = () => {
    if (!category || pending) return;
    const trimmed = note.trim();
    onSubmit({
      reject_category: category,
      ...(trimmed ? { decision_note: trimmed } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>提案を却下</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reject-proposal-category">理由</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ProposalRejectCategory)}
              disabled={pending}
            >
              <SelectTrigger id="reject-proposal-category">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {REJECT_CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reject-proposal-note">補足（任意）</Label>
            <Textarea
              id="reject-proposal-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="whitespace-pre-wrap break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!category || pending}
            onClick={handleSubmit}
          >
            却下する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
