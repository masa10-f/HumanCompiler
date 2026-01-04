'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { logger } from '@/lib/logger'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error('Next.js Global Error', error, {
      component: 'GlobalError',
      digest: error.digest,
    })
  }, [error])

  return (
    <html lang="ja">
      <body>
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <div className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-2 text-red-600 mb-4">
              <AlertTriangle className="h-6 w-6" />
              <h2 className="text-xl font-bold">エラーが発生しました</h2>
            </div>

            <p className="text-gray-600 mb-6">
              申し訳ございませんが、問題が発生しました。
            </p>

            <button
              onClick={() => reset()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              再試行
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
