/**
 * @fileoverview タイムライン関連の型定義
 * @description プロジェクト・ゴール・タスクのタイムライン表示に使用する型を定義
 */

/**
 * タイムライン用タスク情報
 * @description タイムライン表示に必要なタスクの詳細情報
 */
export interface TimelineTask {
  /** タスクID */
  id: string
  /** 所属ゴールID */
  goal_id: string
  /** タスクタイトル */
  title: string
  /** タスク説明 */
  description: string | null
  /** タスクステータス */
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** 見積もり時間（時間単位） */
  estimate_hours: number
  /** 期限日 (ISO 8601形式) */
  due_date: string | null
  /** 作成日時 (ISO 8601形式) */
  created_at: string
  /** 更新日時 (ISO 8601形式) */
  updated_at: string
  /** 進捗率（0-100%） */
  progress_percentage: number
  /** ステータス表示色 */
  status_color: string
  /** 実績時間（時間単位） */
  actual_hours: number
  /** ログ件数 */
  logs_count: number
  /** 最初に作業ログが記録された日時 (ISO 8601形式) */
  first_logged_at?: string | null
  /** 最後に作業ログが記録された日時 (ISO 8601形式) */
  last_logged_at?: string | null
}

/**
 * タイムライン用ゴール情報
 * @description タイムライン表示に必要なゴールの詳細情報（タスク一覧含む）
 */
export interface TimelineGoal {
  /** ゴールID */
  id: string
  /** ゴールタイトル */
  title: string
  /** ゴール説明 */
  description: string | null
  /** ゴールステータス */
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** 見積もり時間（時間単位） */
  estimate_hours: number
  /** 開始日 (ISO 8601形式) */
  start_date: string | null
  /** 終了日 (ISO 8601形式) */
  end_date: string | null
  /** 期限日 (ISO 8601形式) */
  due_date: string | null
  /** 依存先ゴールIDリスト */
  dependencies: string[]
  /** 作成日時 */
  created_at: string
  /** 更新日時 */
  updated_at: string
  /** 所属タスク一覧 */
  tasks: TimelineTask[]
  /** 配下タスクで最初に作業ログが記録された日時 */
  actual_start_date?: string | null
  /** 配下タスクで最後に作業ログが記録された日時 */
  actual_end_date?: string | null
}

/**
 * プロジェクトの週間キャパシティ
 * @description トリアージ設定（キャパ配分）から算出した値
 */
export interface ProjectCapacity {
  /** 週の稼働時間 */
  weekly_capacity_hours: number
  /** バッファ時間（会議など） */
  meeting_buffer_hours: number
  /** 実効稼働時間（稼働時間 - バッファ） */
  effective_capacity_hours: number
  /** プロジェクトのエフォート比（0-100%） */
  effort_percent: number
  /** プロジェクトに割り当てる週間作業時間（実効稼働時間 × エフォート比） */
  weekly_work_hours: number
  /** トリアージ設定が保存済みか（未保存なら既定値） */
  configured: boolean
}

/**
 * プロジェクトタイムラインデータ
 * @description 単一プロジェクトのタイムライン表示用データ
 */
export interface ProjectTimelineData {
  /** プロジェクト基本情報 */
  project: {
    /** プロジェクトID */
    id: string
    /** プロジェクトタイトル */
    title: string
    /** プロジェクト説明 */
    description: string | null
    /** 週間作業時間（時間単位）: トリアージ設定の実効稼働時間 × エフォート比 */
    weekly_work_hours: number
    /** トリアージ設定（キャパ配分）から算出した週間キャパシティ */
    capacity: ProjectCapacity
    /** 作成日時 */
    created_at: string
    /** 更新日時 */
    updated_at: string
  }
  /** タイムライン期間情報 */
  timeline: {
    /** 開始日 (ISO 8601形式) */
    start_date: string
    /** 終了日 (ISO 8601形式) */
    end_date: string
    /** 時間単位 (day/week/month) */
    time_unit: string
  }
  /** ゴール一覧 */
  goals: TimelineGoal[]
}

/**
 * プロジェクト統計情報
 * @description プロジェクトのゴール・タスク進捗統計
 */
export interface ProjectStatistics {
  /** 総ゴール数 */
  total_goals: number
  /** 完了ゴール数 */
  completed_goals: number
  /** 進行中ゴール数 */
  in_progress_goals: number
  /** 総タスク数 */
  total_tasks: number
  /** 完了タスク数 */
  completed_tasks: number
  /** 進行中タスク数 */
  in_progress_tasks: number
  /** ゴール完了率（0-100%） */
  goals_completion_rate: number
  /** タスク完了率（0-100%） */
  tasks_completion_rate: number
}

/**
 * タイムライン用プロジェクト情報
 * @description 統計情報を含むプロジェクト概要
 */
export interface TimelineProject {
  /** プロジェクトID */
  id: string
  /** プロジェクトタイトル */
  title: string
  /** プロジェクト説明 */
  description: string | null
  /** 作成日時 */
  created_at: string
  /** 更新日時 */
  updated_at: string
  /** 統計情報 */
  statistics: ProjectStatistics
}

/**
 * タイムライン概要データ
 * @description 全プロジェクトのタイムライン概要
 */
export interface TimelineOverviewData {
  /** タイムライン期間情報 */
  timeline: {
    /** 開始日 (ISO 8601形式) */
    start_date: string
    /** 終了日 (ISO 8601形式) */
    end_date: string
  }
  /** プロジェクト一覧 */
  projects: TimelineProject[]
}

/**
 * タイムラインフィルター
 * @description タイムライン表示のフィルタリングオプション
 */
export interface TimelineFilters {
  /** 開始日フィルター (ISO 8601形式) */
  start_date?: string
  /** 終了日フィルター (ISO 8601形式) */
  end_date?: string
  /** 時間単位 (day: 日単位, week: 週単位, month: 月単位) */
  time_unit: 'day' | 'week' | 'month'
  /** 依存関係を表示するか */
  show_dependencies?: boolean
  /** タスクセグメントを表示するか */
  show_task_segments?: boolean
}
