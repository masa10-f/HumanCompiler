/**
 * @fileoverview 作業ログ関連の型定義
 * @description タスクに対する作業時間記録の型を定義
 */

/**
 * 作業ログ
 * @description タスクに対する作業時間の記録
 */
export interface Log {
  /** ログID (UUID) */
  id: string;
  /** 対象タスクID */
  task_id: string;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** コメント・メモ */
  comment?: string;
  /** この時間を計測した Runner セッション。手入力などの記録では null */
  work_session_id?: string | null;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
}

/**
 * 作業ログ作成リクエスト
 * @description 新規作業ログ作成時のパラメータ
 */
export interface LogCreate {
  /** 対象タスクID */
  task_id: string;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** コメント・メモ */
  comment?: string;
  /** 記録後に残っている作業時間（時間）。指定するとタスクの見積を合わせて更新する */
  remaining_estimate_hours?: number;
  /** この記録でタスクを完了にする */
  complete_task?: boolean;
}

/**
 * 作業ログ更新リクエスト
 * @description 作業ログ更新時のパラメータ（全フィールドオプショナル）
 */
export interface LogUpdate {
  /** 実績時間（分単位） */
  actual_minutes?: number;
  /** コメント・メモ */
  comment?: string;
}
