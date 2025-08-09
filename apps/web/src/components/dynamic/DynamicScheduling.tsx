import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

// Loading component for dynamic imports
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
      <p className="text-lg">スケジュール最適化機能を読み込み中...</p>
    </div>
  </div>
)

// Dynamically import Scheduling component
export const DynamicScheduling = dynamic(
  () => import('../../app/scheduling/page').then((mod) => ({ default: mod.default })),
  {
    loading: () => <LoadingSpinner />,
    ssr: false, // Disable SSR for heavy components
  }
)
