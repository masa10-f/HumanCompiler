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
import { EMPTY_KPT, KptFields, type KptValues } from '@/components/work-records/kpt-fields';
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
  const [kpt, setKpt] = useState<KptValues>(EMPTY_KPT);

  const updateMutation = useUpdateWorkSession();

  // Populate form when session changes
  useEffect(() => {
    if (session) {
      setKpt({
        keep: session.kpt_keep ?? '',
        problem: session.kpt_problem ?? '',
        try: session.kpt_try ?? '',
      });
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
          kpt_keep: kpt.keep,
          kpt_problem: kpt.problem,
          kpt_try: kpt.try,
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
          <KptFields idPrefix="edit-kpt" value={kpt} onChange={setKpt} />
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
