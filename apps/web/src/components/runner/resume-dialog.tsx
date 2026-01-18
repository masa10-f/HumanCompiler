'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Play, Clock } from 'lucide-react';

interface ResumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing: boolean;
  pausedDuration: string;
  onConfirm: (extendCheckout: boolean) => Promise<void>;
}

export function ResumeDialog({
  open,
  onOpenChange,
  isProcessing,
  pausedDuration,
  onConfirm,
}: ResumeDialogProps) {
  const [extendCheckout, setExtendCheckout] = useState(true);

  const handleConfirm = async () => {
    await onConfirm(extendCheckout);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            再開
          </DialogTitle>
          <DialogDescription>
            セッションを再開しますか？
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>一時停止時間: {pausedDuration}</span>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="extend-checkout"
              checked={extendCheckout}
              onCheckedChange={(checked) => setExtendCheckout(checked === true)}
            />
            <Label htmlFor="extend-checkout" className="text-sm">
              予定終了時間を一時停止した分だけ延長する
            </Label>
          </div>
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
            {isProcessing ? '処理中...' : '再開'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
