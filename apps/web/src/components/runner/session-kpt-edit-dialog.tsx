'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWorkSession } from '@/hooks/use-work-sessions';
import type { WorkSession } from '@/types/work-session';

interface SessionKptEditDialogProps {
  session: WorkSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionKptEditDialog({
  session,
  open,
  onOpenChange,
}: SessionKptEditDialogProps) {
  const [kptKeep, setKptKeep] = useState('');
  const [kptProblem, setKptProblem] = useState('');
  const [kptTry, setKptTry] = useState('');

  const updateMutation = useUpdateWorkSession();

  // Populate form when session changes
  useEffect(() => {
    if (session) {
      setKptKeep(session.kpt_keep ?? '');
      setKptProblem(session.kpt_problem ?? '');
      setKptTry(session.kpt_try ?? '');
    }
  }, [session]);

  const handleSave = async () => {
    if (!session) return;

    try {
      // Send empty string to clear, non-empty to update
      // Backend will convert empty string to null
      await updateMutation.mutateAsync({
        sessionId: session.id,
        data: {
          kpt_keep: kptKeep,
          kpt_problem: kptProblem,
          kpt_try: kptTry,
        },
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update KPT:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>KPT編集</DialogTitle>
          <DialogDescription>
            セッションの振り返りを編集します
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-kpt-keep" className="text-xs">
              Keep: うまくいったこと
            </Label>
            <Textarea
              id="edit-kpt-keep"
              placeholder="良かった点を記録"
              value={kptKeep}
              onChange={(e) => setKptKeep(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-kpt-problem" className="text-xs">
              Problem: 困ったこと
            </Label>
            <Textarea
              id="edit-kpt-problem"
              placeholder="課題や問題点を記録"
              value={kptProblem}
              onChange={(e) => setKptProblem(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-kpt-try" className="text-xs">
              Try: 次に試したいこと
            </Label>
            <Textarea
              id="edit-kpt-try"
              placeholder="次回への改善点を記録"
              value={kptTry}
              onChange={(e) => setKptTry(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
