/**
 * @fileoverview レポート関連の型定義
 * @description 週次レポート生成に使用する型を定義
 */

/**
 * タスク進捗サマリー
 * @description 週次レポート用の個別タスク進捗情報
 */
export interface TaskProgressSummary {
  /** タスクID */
  task_id: string;
  /** タスクタイトル */
  task_title: string;
  /** 所属プロジェクトタイトル */
  project_title: string;
  /** 所属ゴールタイトル */
  goal_title: string;
  /** 見積もり時間（時間単位） */
  estimated_hours: number;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** 完了率（0-100%） */
  completion_percentage: number;
  /** タスクステータス */
  status: string;
  /** 作業ログ一覧 */
  work_logs: string[];
}

/**
 * プロジェクト進捗サマリー
 * @description 週次レポート用のプロジェクト単位進捗情報
 */
export interface ProjectProgressSummary {
  /** プロジェクトID */
  project_id: string;
  /** プロジェクトタイトル */
  project_title: string;
  /** 総見積もり時間（時間単位） */
  total_estimated_hours: number;
  /** 総実績時間（分単位） */
  total_actual_minutes: number;
  /** 総タスク数 */
  total_tasks: number;
  /** 完了タスク数 */
  completed_tasks: number;
  /** 完了率（0-100%） */
  completion_percentage: number;
  /** 配下タスクの進捗一覧 */
  tasks: TaskProgressSummary[];
}

/**
 * 週次作業サマリー
 * @description 週全体の作業統計情報
 */
export interface WeeklyWorkSummary {
  /** 総実績時間（分単位） */
  total_actual_minutes: number;
  /** 総見積もり時間（時間単位） */
  total_estimated_hours: number;
  /** 作業したタスク数 */
  total_tasks_worked: number;
  /** 完了したタスク数 */
  total_completed_tasks: number;
  /** 全体完了率（0-100%） */
  overall_completion_percentage: number;
  /** 日別作業時間（キー: 日付, 値: 分） */
  daily_breakdown: Record<string, number>;
  /** プロジェクト別作業時間（キー: プロジェクトID, 値: 分） */
  project_breakdown: Record<string, number>;
}

/**
 * 週次レポートリクエスト
 * @description 週次レポート生成時のパラメータ
 */
export interface WeeklyReportRequest {
  /** 週の開始日 (ISO 8601形式、月曜日) */
  week_start_date: string;
  /** フィルター対象プロジェクトID一覧（省略時は全プロジェクト） */
  project_ids?: string[];
}

/**
 * 週次レポートレスポンス
 * @description 生成された週次レポートデータ
 */
export interface WeeklyReportResponse {
  /** 週の開始日 (ISO 8601形式) */
  week_start_date: string;
  /** 週の終了日 (ISO 8601形式) */
  week_end_date: string;
  /** 作業サマリー */
  work_summary: WeeklyWorkSummary;
  /** プロジェクト別進捗サマリー */
  project_summaries: ProjectProgressSummary[];
  /** Markdown形式のレポート本文 */
  markdown_report: string;
  /** レポート生成日時 (ISO 8601形式) */
  generated_at: string;
}
