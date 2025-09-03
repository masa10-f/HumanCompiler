"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdateLog } from "@/hooks/use-logs-query";
import { showErrorToast } from "@/lib/error-toast";
import { useToast } from "@/hooks/use-toast";
import type { Log, LogUpdate } from "@/types/log";
import { sanitizeInput, isInputSafe } from "@/lib/sanitize";

const logEditFormSchema = z.object({
  actual_hours: z.number().min(0.1, "実作業時間は0.1時間以上である必要があります"),
  comment: z.string().optional().refine(
    (value) => !value || isInputSafe(value),
    { message: "コメントに不正な内容が含まれています" }
  ),
});

type LogEditFormData = z.infer<typeof logEditFormSchema>;

interface LogEditDialogProps {
  log: Log;
  trigger?: React.ReactNode;
}

export function LogEditDialog({ log, trigger }: LogEditDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const updateLogMutation = useUpdateLog();

  const form = useForm<LogEditFormData>({
    resolver: zodResolver(logEditFormSchema),
    defaultValues: {
      actual_hours: log.actual_minutes / 60, // Convert minutes to hours
      comment: log.comment || "",
    },
  });

  const onSubmit = (data: LogEditFormData) => {
    const updateData: LogUpdate = {
      actual_minutes: Math.round(data.actual_hours * 60), // Convert hours to minutes for API
      comment: data.comment ? sanitizeInput(data.comment) : undefined,
    };

    updateLogMutation.mutate(
      { id: log.id, data: updateData },
      {
        onSuccess: () => {
          toast({
            title: "作業ログを更新しました",
            description: "作業時間とコメントが正常に更新されました。",
          });
          setOpen(false);
        },
        onError: (error) => {
          showErrorToast(error, { title: "作業ログの更新に失敗しました" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            編集
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>作業ログの編集</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="actual_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>実作業時間（時間）</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="24"
                      {...field}
                      onChange={(e) => {
                        const value = e.target.value;
                        field.onChange(value === "" ? undefined : parseFloat(value) || undefined);
                      }}
                      placeholder="例: 2.5（2時間30分）"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>コメント（任意）</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="作業内容や感想を記録..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={updateLogMutation.isPending}>
                {updateLogMutation.isPending ? "更新中..." : "更新"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
