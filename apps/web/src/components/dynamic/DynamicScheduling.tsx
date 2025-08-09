import dynamic from 'next/dynamic'
import { Loader2, AlertCircle } from 'lucide-react'
import type { ComponentType } from 'react'

// Loading component for dynamic imports
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen" role="status" aria-label="スケジュール最適化機能を読み込み中">
    <div className="text-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" aria-hidden="true" />
      <p className="text-lg">スケジュール最適化機能を読み込み中...</p>
    </div>
  </div>
)

// Error fallback component
const ErrorFallback = () => (
  <div className="flex items-center justify-center min-h-screen" role="alert">
    <div className="text-center">
      <AlertCircle className="h-8 w-8 text-red-600 mx-auto mb-4" aria-hidden="true" />
      <p className="text-lg text-red-600">スケジュール最適化機能の読み込みに失敗しました</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        再読み込み
      </button>
    </div>
  </div>
)

// Type-safe dynamic import with better error handling
export const DynamicScheduling = dynamic(
  () => import('../../app/scheduling/page')
    .then((mod) => ({ default: mod.default }))
    .catch(() => ({ default: ErrorFallback as ComponentType })),
  {
    loading: () => <LoadingSpinner />,
    ssr: false, // Disable SSR for heavy components
  }
)
