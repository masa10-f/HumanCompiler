"use client"

import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  children: React.ReactNode
  fallback?: React.ComponentType<ErrorFallbackProps>
}

interface ErrorFallbackProps {
  error: Error
  resetErrorBoundary: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class TimelineErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Timeline Error Boundary caught an error:', error, errorInfo)

    // Log to external service if available
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: `Timeline Error: ${error.message}`,
        fatal: false,
      })
    }
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback
      return (
        <FallbackComponent
          error={this.state.error!}
          resetErrorBoundary={this.resetErrorBoundary}
        />
      )
    }

    return this.props.children
  }
}

function DefaultErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  const isDevelopment = process.env.NODE_ENV === 'development'

  return (
    <Card className="w-full max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="h-5 w-5" />
          タイムライン表示エラー
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-gray-600">
          タイムラインの表示中にエラーが発生しました。以下のボタンをクリックして再試行するか、ページをリロードしてください。
        </p>

        {isDevelopment && (
          <details className="bg-gray-50 p-4 rounded-lg">
            <summary className="cursor-pointer font-medium text-gray-700 mb-2">
              エラー詳細 (開発環境)
            </summary>
            <pre className="text-xs text-red-600 whitespace-pre-wrap overflow-x-auto">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}

        <div className="flex gap-3">
          <Button onClick={resetErrorBoundary} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            再試行
          </Button>

          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2"
          >
            ページをリロード
          </Button>
        </div>

        <div className="text-sm text-gray-500 border-t pt-4 mt-4">
          <p>
            この問題が継続する場合は、以下をお試しください：
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>ブラウザのキャッシュをクリア</li>
            <li>別のブラウザで試行</li>
            <li>プロジェクトデータの整合性を確認</li>
            <li>開発チームにお問い合わせ</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

// Higher-order component for easier usage
export function withTimelineErrorBoundary<T extends object>(
  Component: React.ComponentType<T>,
  fallback?: React.ComponentType<ErrorFallbackProps>
) {
  const WrappedComponent = (props: T) => (
    <TimelineErrorBoundary fallback={fallback}>
      <Component {...props} />
    </TimelineErrorBoundary>
  )

  WrappedComponent.displayName = `withTimelineErrorBoundary(${Component.displayName || Component.name})`

  return WrappedComponent
}

// Hook for programmatic error handling
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null)
  const [hasThrown, setHasThrown] = React.useState(false)

  const resetError = React.useCallback(() => {
    setError(null)
    setHasThrown(false)
  }, [])

  const handleError = React.useCallback((error: Error) => {
    console.error('Timeline Error:', error)
    setError(error)
    setHasThrown(false) // Reset thrown state for new error

    // Log to external service if available
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: `Timeline Error: ${error.message}`,
        fatal: false,
      })
    }
  }, [])
  React.useEffect(() => {
    if (error && !hasThrown) {
      setHasThrown(true)
      throw error
    }
  }, [error, hasThrown])

  return { handleError, resetError }
}
