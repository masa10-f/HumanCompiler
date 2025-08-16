import dynamic from 'next/dynamic';
import { Metadata } from 'next';

const OptimizationDashboard = dynamic(
  () => import('@/components/optimization/OptimizationDashboard'),
  {
    ssr: false,
    loading: () => (
      <div className="max-w-7xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <div className="h-64 bg-gray-200 rounded"></div>
              <div className="h-48 bg-gray-200 rounded"></div>
            </div>
            <div className="lg:col-span-2">
              <div className="h-96 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    ),
  }
);

export const metadata: Metadata = {
  title: 'ハイブリッド最適化パイプライン - TaskAgent',
  description: 'GPT-5 + OR-Tools による週間タスク計画・日次スケジュール最適化',
  keywords: ['AI', 'GPT-5', 'OR-Tools', '最適化', 'タスク管理', 'スケジュール'],
};

export default function OptimizationPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <OptimizationDashboard />
    </div>
  );
}
