/**
 * @fileoverview 進捗関連の型定義
 * @description タスク・ゴール・プロジェクトの進捗状況を表す型を定義
 */

/**
 * タスク進捗情報
 * @description 個別タスクの進捗状況
 */
export interface TaskProgress {
  /** タスクID */
  task_id: string;
  /** タスクタイトル */
  title: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** 進捗率（0-100%） */
  progress_percentage: number;
  /** タスクステータス */
  status: string;
}

/**
 * ゴール進捗情報
 * @description ゴールの進捗状況（配下タスクの進捗含む）
 */
export interface GoalProgress {
  /** ゴールID */
  goal_id: string;
  /** ゴールタイトル */
  title: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** 進捗率（0-100%） */
  progress_percentage: number;
  /** 配下タスクの進捗一覧 */
  tasks: TaskProgress[];
}

/**
 * プロジェクト進捗情報
 * @description プロジェクトの進捗状況（配下ゴールの進捗含む）
 */
export interface ProjectProgress {
  /** プロジェクトID */
  project_id: string;
  /** プロジェクトタイトル */
  title: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 実績時間（分単位） */
  actual_minutes: number;
  /** 進捗率（0-100%） */
  progress_percentage: number;
  /** 配下ゴールの進捗一覧 */
  goals: GoalProgress[];
}
