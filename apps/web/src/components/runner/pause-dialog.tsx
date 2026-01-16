'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Pause } from 'lucide-react';

interface PauseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing: boolean;
  onConfirm: () => Promise<void>;
}

export function PauseDialog({
  open,
  onOpenChange,
  isProcessing,
  onConfirm,
}: PauseDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pause className="h-5 w-5" />
            一時停止
          </DialogTitle>
          <DialogDescription>
            セッションを一時停止しますか？
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            一時停止中の時間は作業時間にカウントされません。
            再開時に予定終了時間を延長するか選択できます。
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            キャンセル
          </Button>
          <Button onClick={handleConfirm} disabled={isProcessing}>
            {isProcessing ? '処理中...' : '一時停止'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
