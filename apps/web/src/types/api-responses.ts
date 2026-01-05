/**
 * @fileoverview APIレスポンス型定義
 * @description 各種API呼び出しのレスポンス型を定義
 */

/**
 * AI連携テストレスポンス
 * @description AI機能の接続テスト結果
 */
export interface TestAIIntegrationResponse {
  /** 成功したかどうか */
  success: boolean;
  /** 結果メッセージ */
  message: string;
  /** アシスタントID（成功時） */
  assistant_id?: string;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/**
 * デイリースケジュール保存レスポンス
 * @description スケジュール保存結果
 */
export interface SaveDailyScheduleResponse {
  /** 成功したかどうか */
  success: boolean;
  /** 保存されたスケジュールID */
  schedule_id: string;
  /** 結果メッセージ */
  message: string;
}

/**
 * デイリースケジュール
 * @description 日次スケジュールの保存データ
 */
export interface DailySchedule {
  /** スケジュールID */
  id: string;
  /** ユーザーID */
  user_id: string;
  /** 対象日付 (ISO 8601形式) */
  date: string;
  /** スケジュールJSON */
  plan_json: {
    /** 最適化成功したか */
    success: boolean;
    /** タスク割り当て一覧 */
    assignments: Array<{
      /** タスクID */
      task_id: string;
      /** タスクタイトル */
      task_title: string;
      /** ゴールID */
      goal_id: string;
      /** プロジェクトID */
      project_id: string;
      /** タイムスロットインデックス */
      slot_index: number;
      /** 開始時刻 */
      start_time: string;
      /** 作業時間（時間単位） */
      duration_hours: number;
      /** スロット開始時刻 */
      slot_start: string;
      /** スロット終了時刻 */
      slot_end: string;
      /** スロット種別 */
      slot_kind: string;
    }>;
    /** 未スケジュールタスク一覧 */
    unscheduled_tasks: Array<{
      /** タスクID */
      id: string;
      /** タスクタイトル */
      title: string;
      /** 見積もり時間（時間単位） */
      estimate_hours: number;
      /** 優先度 */
      priority: number;
      /** 作業種別 */
      kind: string;
      /** 期限日 */
      due_date?: string;
      /** ゴールID */
      goal_id?: string;
      /** プロジェクトID */
      project_id?: string;
    }>;
    /** 総スケジュール時間（時間単位） */
    total_scheduled_hours: number;
    /** 最適化ステータス */
    optimization_status: string;
    /** 解決時間（秒） */
    solve_time_seconds: number;
    /** 目的関数値 */
    objective_value?: number;
    /** 生成日時 (ISO 8601形式) */
    generated_at: string;
  };
  /** 作成日時 */
  created_at: string;
  /** 更新日時 */
  updated_at: string;
}

/**
 * スケジューラーテストレスポンス
 * @description スケジューラー機能のテスト結果
 */
export interface TestSchedulerResponse {
  /** 成功したかどうか */
  success: boolean;
  /** 結果メッセージ */
  message: string;
  /** テスト結果詳細（成功時） */
  test_result?: {
    /** 割り当てられたタスク数 */
    assignments_count: number;
    /** 未スケジュールタスク数 */
    unscheduled_count: number;
    /** 総時間 */
    total_hours: number;
    /** ステータス */
    status: string;
  };
  /** エラーメッセージ（失敗時） */
  error?: string;
}
