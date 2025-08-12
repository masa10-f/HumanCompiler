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
import { logsApi } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { useToast } from "@/hooks/use-toast";
import type { LogCreate } from "@/types/log";

const logFormSchema = z.object({
  actual_minutes: z.number().min(1, "実作業時間は1分以上である必要があります"),
  comment: z.string().optional(),
});

type LogFormData = z.infer<typeof logFormSchema>;

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
    defaultValues: {
      actual_minutes: 0,
      comment: "",
    },
  });

  const createLogMutation = useMutation({
    mutationFn: (data: LogCreate) => logsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logs", "task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({
        title: "作業時間を登録しました",
        description: `${taskTitle}の実作業時間を記録しました。`,
      });
      setOpen(false);
      form.reset();
    },
    onError: (error) => {
      console.error("Failed to create log:", error);
      showErrorToast(error, "作業時間の登録に失敗しました");
    },
  });

  const onSubmit = (data: LogFormData) => {
    createLogMutation.mutate({
      task_id: taskId,
      actual_minutes: data.actual_minutes,
      comment: data.comment || undefined,
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
              name="actual_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>実作業時間（分）</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      placeholder="例: 120"
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