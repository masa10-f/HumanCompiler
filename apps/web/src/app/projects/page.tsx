'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';
import { ProjectEditDialog } from '@/components/projects/project-edit-dialog';
import { ProjectDeleteDialog } from '@/components/projects/project-delete-dialog';

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const { projects, loading, error, refetch } = useProjects();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center">
          <div className="text-lg">プロジェクトを読み込み中...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <div className="text-red-600 mb-4">エラー: {error}</div>
          <Button onClick={refetch}>再試行</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">プロジェクト一覧</h1>
          <p className="text-gray-600 mt-2">研究・開発プロジェクトを管理します。</p>
        </div>
        <ProjectFormDialog>
          <Button>
            新規プロジェクト作成
          </Button>
        </ProjectFormDialog>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>プロジェクトがまだありません</CardTitle>
            <CardDescription>
              新しいプロジェクトを作成して開始しましょう。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectFormDialog>
              <Button>
                最初のプロジェクトを作成
              </Button>
            </ProjectFormDialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <CardTitle className="line-clamp-1">{project.title}</CardTitle>
                <CardDescription className="line-clamp-2">
                  {project.description || 'プロジェクトの説明がありません'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center text-sm text-gray-500">
                  <span>作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}</span>
                  <div className="flex gap-2">
                    <ProjectEditDialog project={project}>
                      <Button variant="outline" size="sm">
                        編集
                      </Button>
                    </ProjectEditDialog>
                    <ProjectDeleteDialog project={project}>
                      <Button variant="outline" size="sm">
                        削除
                      </Button>
                    </ProjectDeleteDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}