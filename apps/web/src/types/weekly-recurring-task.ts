/**
 * @fileoverview 週次定期タスク関連の型定義
 * @description 毎週繰り返し発生するタスクの管理に使用する型を定義
 */

/**
 * タスクカテゴリ
 * @description 定期タスクの分類カテゴリ
 */
export type TaskCategory =
  | 'WORK'      // 仕事
  | 'STUDY'     // 学習
  | 'PERSONAL'  // 個人
  | 'HEALTH'    // 健康
  | 'OTHER';    // その他

/**
 * 週次定期タスク
 * @description 毎週繰り返し発生するタスクの定義
 */
export interface WeeklyRecurringTask {
  /** タスクID (UUID) */
  id: string;
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** カテゴリ */
  category: TaskCategory;
  /** 有効かどうか */
  is_active: boolean;
  /** 削除日時（論理削除用） */
  deleted_at?: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 更新日時 (ISO 8601形式) */
  updated_at: string;
}

/**
 * 週次定期タスク作成リクエスト
 * @description 新規定期タスク作成時のパラメータ
 */
export interface WeeklyRecurringTaskCreate {
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** カテゴリ（デフォルト: OTHER） */
  category?: TaskCategory;
  /** 有効かどうか（デフォルト: true） */
  is_active?: boolean;
}

/**
 * 週次定期タスク更新リクエスト
 * @description 定期タスク更新時のパラメータ（全フィールドオプショナル）
 */
export interface WeeklyRecurringTaskUpdate {
  /** タスクタイトル */
  title?: string;
  /** タスク説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours?: number;
  /** カテゴリ */
  category?: TaskCategory;
  /** 有効かどうか */
  is_active?: boolean;
}
