'use client';

import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CalendarRange,
  History,
  LayoutTemplate,
  SlidersHorizontal,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

const schedulingItems = [
  {
    title: '日次スケジュール',
    path: '/scheduling/daily',
    icon: CalendarDays,
    action: '開く',
  },
  {
    title: '週次スケジュール',
    path: '/scheduling/weekly',
    icon: CalendarRange,
    action: '開く',
  },
  {
    title: 'Scheduler調整',
    path: '/scheduling/tuning',
    icon: SlidersHorizontal,
    action: '調整',
  },
  {
    title: 'スロットテンプレート',
    path: '/scheduling/settings',
    icon: LayoutTemplate,
    action: '編集',
  },
  {
    title: 'スケジュール履歴',
    path: '/scheduling/history',
    icon: History,
    action: '確認',
  },
];

export default function SchedulingHomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="scheduling" />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">スケジューリング</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              日次・週次・調整・履歴
            </p>
          </div>
          <Button onClick={() => router.push('/scheduling/daily')}>
            <CalendarDays className="mr-2 h-4 w-4" />
            日次を作成
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {schedulingItems.map((item) => (
            <Card key={item.path} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <item.icon className="h-5 w-5 text-blue-600" />
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => router.push(item.path)}
                >
                  {item.action}
                  <item.icon className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
