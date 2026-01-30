'use client';

import { useState, useEffect, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from '@/hooks/use-project-query';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit, Trash2, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AppHeader } from '@/components/layout/app-header';
import { QuickTaskList } from '@/components/quick-tasks';
import { log } from '@/lib/logger';
import { Project, ProjectStatus } from '@/types/project';
import {
  getProjectStatusIcon,
  getProjectStatusLabel,
  getAllProjectStatuses
} from '@/constants/project-status';
import { SortBy, SortOrder, SortOptions } from '@/types/sort';
import { SortDropdown } from '@/components/ui/sort-dropdown';

// Component to display and manage project status
const ProjectStatusDropdown = memo(function ProjectStatusDropdown({ project }: { project: Project }) {
  const updateProjectMutation = useUpdateProject();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    if (newStatus === project.status || isUpdating) return;

    setIsUpdating(true);
    try {
      await updateProjectMutation.mutateAsync({
        id: project.id,
        data: { status: newStatus }
      });

      toast({
        title: 'ステータスを更新しました',
        description: `プロジェクトのステータスを「${getProjectStatusLabel(newStatus)}」に変更しました。`,
      });
    } catch (error) {
      let errorMessage = 'ステータスの更新に失敗しました。';
      let errorTitle = 'エラー';

      const errorStatus = (error as { response?: { status?: number } })?.response?.status;

      if (errorStatus === 404) {
        errorTitle = 'プロジェクトが見つかりません';
        errorMessage = '更新対象のプロジェクトが削除されている可能性があります。';
      } else if (errorStatus === 403) {
        errorTitle = '権限エラー';
        errorMessage = 'このプロジェクトを更新する権限がありません。';
      } else if (errorStatus === 422) {
        errorTitle = '入力エラー';
        errorMessage = '無効なステータス値です。ページを再読み込みしてください。';
      } else if (errorStatus && errorStatus >= 500) {
        errorTitle = 'サーバーエラー';
        errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。';
      } else if (!navigator.onLine) {
        errorTitle = 'ネットワークエラー';
        errorMessage = 'インターネット接続を確認してください。';
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const currentStatus = project.status || 'pending';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
          disabled={isUpdating}
        >
          {getProjectStatusIcon(currentStatus)}
          <span className="text-sm">{getProjectStatusLabel(currentStatus)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {getAllProjectStatuses().map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleStatusChange(status);
            }}
            className={currentStatus === status ? 'bg-gray-100' : ''}
          >
            <div className="flex items-center gap-2">
              {getProjectStatusIcon(status)}
              <span>{getProjectStatusLabel(status)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Sort state
  const [sortOptions, setSortOptions] = useState<SortOptions>({
    sortBy: SortBy.STATUS,
    sortOrder: SortOrder.ASC,
  });

  const { data: projects = [], isLoading: loading, error, refetch } = useProjects(0, 20, sortOptions);
  const createProjectMutation = useCreateProject();
  const updateProjectMutation = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedProject, setSelectedProject] = useState<typeof projects[0] | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      log.component('Projects', 'createProject', { title, description });

      await createProjectMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'pending',
      });

      toast({
        title: 'プロジェクトを作成しました',
        description: `「${title}」が正常に作成されました。`,
      });

      log.component('Projects', 'projectCreated', { title });
      setTitle('');
      setDescription('');
      setShowCreateForm(false);
    } catch (err) {
      log.error('Failed to create project', err as Error, { component: 'Projects', title, description });

      toast({
        title: 'エラー',
        description: 'プロジェクトの作成に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  const handleEditProject = (project: typeof projects[0]) => {
    setSelectedProject(project);
    setEditTitle(project.title);
    setEditDescription(project.description || '');
    setShowEditDialog(true);
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !editTitle.trim()) return;

    try {
      log.component('Projects', 'updateProject', {
        id: selectedProject.id,
        title: editTitle,
        description: editDescription
      });

      await updateProjectMutation.mutateAsync({
        id: selectedProject.id,
        data: {
          title: editTitle.trim(),
          description: editDescription.trim() || undefined,
        },
      });

      toast({
        title: 'プロジェクトを更新しました',
        description: `「${editTitle}」が正常に更新されました。`,
      });

      log.component('Projects', 'projectUpdated', { id: selectedProject.id, title: editTitle });
      setShowEditDialog(false);
      setSelectedProject(null);
    } catch (err) {
      log.error('Failed to update project', err as Error, {
        component: 'Projects',
        id: selectedProject.id,
        title: editTitle
      });

      toast({
        title: 'エラー',
        description: 'プロジェクトの更新に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteProject = (project: typeof projects[0]) => {
    setSelectedProject(project);
    setShowDeleteDialog(true);
  };

  const confirmDeleteProject = async () => {
    if (!selectedProject) return;

    try {
      log.component('Projects', 'deleteProject', { id: selectedProject.id, title: selectedProject.title });

      await deleteProjectMutation.mutateAsync(selectedProject.id);

      toast({
        title: 'プロジェクトを削除しました',
        description: `「${selectedProject.title}」が正常に削除されました。`,
      });

      log.component('Projects', 'projectDeleted', { id: selectedProject.id, title: selectedProject.title });
      setShowDeleteDialog(false);
      setSelectedProject(null);
    } catch (err) {
      log.error('Failed to delete project', err as Error, {
        component: 'Projects',
        id: selectedProject.id,
        title: selectedProject.title
      });

      toast({
        title: 'エラー',
        description: 'プロジェクトの削除に失敗しました。再試行してください。',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="projects" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">プロジェクト一覧</h1>
            <p className="text-gray-600 mt-2">研究・開発プロジェクトを管理します。</p>
          </div>
          <div className="flex items-center gap-4">
            <SortDropdown
              currentSort={sortOptions}
              onSortChange={setSortOptions}
              sortFields={[
                { value: SortBy.STATUS, label: 'ステータス' },
                { value: SortBy.TITLE, label: 'タイトル' },
                { value: SortBy.CREATED_AT, label: '作成日' },
                { value: SortBy.UPDATED_AT, label: '更新日' },
              ]}
            />
            <Button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              新規プロジェクト作成
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              再試行
            </Button>
          </div>
        )}

        {/* Create Form */}
        {showCreateForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>新規プロジェクト作成</CardTitle>
              <CardDescription>
                新しいプロジェクトの情報を入力してください。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">プロジェクト名 *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="プロジェクト名を入力"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">説明</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="プロジェクトの説明を入力（任意）"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateForm(false);
                      setTitle('');
                      setDescription('');
                    }}
                    disabled={createProjectMutation.isPending}
                  >
                    キャンセル
                  </Button>
                  <Button type="submit" disabled={createProjectMutation.isPending || !title.trim()}>
                    {createProjectMutation.isPending ? '作成中...' : '作成'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Projects List */}
        {loading ? (
          <div className="text-center py-8">
            <div className="text-lg">プロジェクトを読み込み中...</div>
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>プロジェクトがまだありません</CardTitle>
              <CardDescription>
                新しいプロジェクトを作成して開始しましょう。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                最初のプロジェクトを作成
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="hover:shadow-lg transition-shadow relative"
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <CardTitle className="line-clamp-1 pr-8">{project.title}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {project.description || 'プロジェクトの説明がありません'}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="sr-only">アクションメニューを開く</span>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditProject(project);
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          編集
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(project);
                          }}
                          className="text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          削除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-500">
                        作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <ProjectStatusDropdown project={project} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Quick Tasks Section */}
        <div className="mt-8">
          <QuickTaskList />
        </div>

        {/* Edit Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>プロジェクトを編集</DialogTitle>
              <DialogDescription>
                プロジェクトの情報を更新してください。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateProject}>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">プロジェクト名 *</Label>
                  <Input
                    id="edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="プロジェクト名を入力"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-description">説明</Label>
                  <Textarea
                    id="edit-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="プロジェクトの説明を入力（任意）"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowEditDialog(false);
                    setSelectedProject(null);
                  }}
                  disabled={updateProjectMutation.isPending}
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  disabled={updateProjectMutation.isPending || !editTitle.trim()}
                >
                  {updateProjectMutation.isPending ? '更新中...' : '更新'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>プロジェクトを削除しますか？</DialogTitle>
              <DialogDescription>
                「{selectedProject?.title}」を削除します。この操作は取り消せません。
                プロジェクトに関連するすべてのゴール、タスク、ログも削除されます。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setSelectedProject(null);
                }}
                disabled={deleteProjectMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                onClick={confirmDeleteProject}
                variant="destructive"
                disabled={deleteProjectMutation.isPending}
              >
                {deleteProjectMutation.isPending ? '削除中...' : '削除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
