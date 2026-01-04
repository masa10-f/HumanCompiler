import { ApiError } from '@/lib/errors'

export type ResourceType = 'project' | 'goal' | 'task'

interface StatusErrorResult {
  title: string
  message: string
}

const resourceLabels: Record<ResourceType, string> = {
  project: 'プロジェクト',
  goal: 'ゴール',
  task: 'タスク',
}

export function getStatusUpdateError(
  error: Error,
  resourceType: ResourceType
): StatusErrorResult {
  const resourceLabel = resourceLabels[resourceType]
  let errorMessage = 'ステータスの更新に失敗しました。'
  let errorTitle = 'エラー'

  const errorStatus = error instanceof ApiError ? error.statusCode : undefined

  if (errorStatus === 404) {
    errorTitle = `${resourceLabel}が見つかりません`
    errorMessage = `更新対象の${resourceLabel}が削除されている可能性があります。`
  } else if (errorStatus === 403) {
    errorTitle = '権限エラー'
    errorMessage = `この${resourceLabel}を更新する権限がありません。`
  } else if (errorStatus === 422) {
    errorTitle = '入力エラー'
    errorMessage = '無効なステータス値です。ページを再読み込みしてください。'
  } else if (errorStatus && errorStatus >= 500) {
    errorTitle = 'サーバーエラー'
    errorMessage = 'サーバーで問題が発生しました。しばらく時間をおいてから再試行してください。'
  } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
    errorTitle = 'ネットワークエラー'
    errorMessage = 'インターネット接続を確認してください。'
  }

  return { title: errorTitle, message: errorMessage }
}
