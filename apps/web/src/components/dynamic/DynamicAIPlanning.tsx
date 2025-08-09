import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

// Loading component for dynamic imports
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-4" />
      <p className="text-lg">AI計画機能を読み込み中...</p>
    </div>
  </div>
)

// Dynamically import AI Planning component
export const DynamicAIPlanning = dynamic(
  () => import('../../app/ai-planning/page').then((mod) => ({ default: mod.default })),
  {
    loading: () => <LoadingSpinner />,
    ssr: false, // Disable SSR for heavy components
  }
)
