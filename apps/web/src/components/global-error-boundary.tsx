"use client"

import React from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { logger } from '@/lib/logger'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })

    logger.error('Global Error Boundary caught an error', error, {
      component: 'GlobalErrorBoundary',
      action: 'componentDidCatch',
    })

    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: `App Error: ${error.message}`,
        fatal: true,
      })
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      const isDevelopment = process.env.NODE_ENV === 'development'

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-6 w-6" />
                アプリケーションエラー
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                予期しないエラーが発生しました。ご不便をおかけして申し訳ございません。
              </p>

              {isDevelopment && this.state.error && (
                <details className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300 mb-2">
                    エラー詳細 (開発環境)
                  </summary>
                  <pre className="text-xs text-red-600 whitespace-pre-wrap overflow-x-auto">
                    {this.state.error.message}
                    {this.state.error.stack && `\n\n${this.state.error.stack}`}
                  </pre>
                  {this.state.errorInfo && (
                    <pre className="mt-4 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap overflow-x-auto">
                      Component Stack:
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </details>
              )}

              <div className="flex gap-3">
                <Button onClick={this.handleReset} className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  再試行
                </Button>

                <Button
                  variant="outline"
                  onClick={this.handleGoHome}
                  className="flex items-center gap-2"
                >
                  <Home className="h-4 w-4" />
                  ホームに戻る
                </Button>
              </div>

              <div className="text-sm text-gray-500 dark:text-gray-400 border-t pt-4 mt-4">
                <p>この問題が継続する場合は、以下をお試しください：</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>ページをリロード</li>
                  <li>ブラウザのキャッシュをクリア</li>
                  <li>別のブラウザで試行</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
