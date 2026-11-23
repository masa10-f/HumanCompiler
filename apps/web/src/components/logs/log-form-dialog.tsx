"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { logsApi } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { useToast } from "@/hooks/use-toast";
import type { LogCreate } from "@/types/log";
import { sanitizeInput, isInputSafe } from "@/lib/sanitize";
import { queryKeys } from "@/lib/query-keys";

const logFormSchema = z.object({
  actual_hours: z.number().min(0.1, "実作業時間は0.1時間以上である必要があります"),
  comment: z.string().optional().refine(
    (value) => !value || isInputSafe(value),
    { message: "コメントに不正な内容が含まれています" }
  ),
  // What is left after this record; the task's estimate follows it.
  remaining_hours: z
    .number()
    .min(0, "残り時間は0以上で入力してください")
    .max(999.99, "残り時間は999.99時間以内で入力してください")
    .optional(),
  complete_task: z.boolean(),
});

type LogFormData = z.infer<typeof logFormSchema>;

const EMPTY_FORM = {
  actual_hours: undefined,
  comment: "",
  remaining_hours: undefined,
  complete_task: false,
};

interface LogFormDialogProps {
  taskId: string;
  taskTitle: string;
  trigger?: React.ReactNode;
}

export function LogFormDialog({ taskId, taskTitle, trigger }: LogFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<LogFormData>({
    resolver: zodResolver(logFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const completing = form.watch("complete_task");

  const createLogMutation = useMutation({
    mutationFn: (data: LogCreate) => logsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.logs.byTask(taskId) });
      // Lists show each task's logged time from the batch query.
      queryClient.invalidateQueries({ queryKey: queryKeys.logs.batches() });
      queryClient.invalidateQueries({ queryKey: queryKeys.progress.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      toast({
        title: "作業時間を登録しました",
        description: `${taskTitle}の実作業時間を記録しました。`,
      });
      setOpen(false);
      form.reset(EMPTY_FORM);
    },
    onError: (error) => {
      showErrorToast(error, { title: "作業時間の登録に失敗しました" });
    },
  });

  const onSubmit = (data: LogFormData) => {
    createLogMutation.mutate({
      task_id: taskId,
      actual_minutes: Math.round(data.actual_hours * 60), // Convert hours to minutes for API
      comment: data.comment ? sanitizeInput(data.comment) : undefined,
      // A finished task has nothing left, whatever the field says.
      remaining_estimate_hours: data.complete_task ? undefined : data.remaining_hours,
      complete_task: data.complete_task || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            時間記録
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>作業時間の記録</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              タスク: {taskTitle}
            </div>

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

            <FormField
              control={form.control}
              name="remaining_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>残りの見込み（時間・任意）</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="999.99"
                      {...field}
                      value={field.value ?? ""}
                      disabled={completing}
                      onChange={(e) => {
                        const value = e.target.value;
                        const parsed = parseFloat(value);
                        field.onChange(value === "" || Number.isNaN(parsed) ? undefined : parsed);
                      }}
                      placeholder="例: 1.5"
                    />
                  </FormControl>
                  <FormDescription>
                    入力すると、タスクの見積を「これまでの実績＋残り」に更新します。
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="complete_task"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">このタスクを完了にする</FormLabel>
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
              <Button type="submit" disabled={createLogMutation.isPending}>
                {createLogMutation.isPending ? "記録中..." : "記録"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
