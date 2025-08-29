'use client';

import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjects } from '@/hooks/use-projects';
import type { Project } from '@/types/project';

const projectFormSchema = z.object({
  title: z.string().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

type ProjectFormData = z.infer<typeof projectFormSchema>;

interface ProjectEditDialogProps {
  project: Project;
  children: React.ReactNode;
}

export function ProjectEditDialog({ project, children }: ProjectEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateProject } = useProjects();

  const form = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      title: project.title,
      description: project.description || '',
      status: project.status || 'pending',
    },
  });

  // Update form values when project changes
  useEffect(() => {
    form.reset({
      title: project.title,
      description: project.description || '',
      status: project.status || 'pending',
    });
  }, [project, form]);

  const onSubmit = async (data: ProjectFormData) => {
    try {
      setIsSubmitting(true);
      await updateProject(project.id, {
        title: data.title,
        description: data.description || undefined,
        status: data.status,
      });
      setOpen(false);
    } catch (error) {
      log.error('Failed to update project', error, { component: 'ProjectEditDialog', projectId: project.id, action: 'updateProject' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>プロジェクト編集</DialogTitle>
          <DialogDescription>
            プロジェクトの情報を編集してください。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>プロジェクト名 *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="プロジェクト名を入力"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>説明</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="プロジェクトの説明を入力（任意）"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ステータス</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="ステータスを選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pending">未開始</SelectItem>
                      <SelectItem value="in_progress">進行中</SelectItem>
                      <SelectItem value="completed">完了</SelectItem>
                      <SelectItem value="cancelled">キャンセル</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? '更新中...' : '更新'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
