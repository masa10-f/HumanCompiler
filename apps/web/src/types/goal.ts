/**
 * @fileoverview ゴール関連の型定義
 * @description ゴールの状態管理、依存関係、CRUD操作の型を定義
 */

/**
 * ゴールのステータス
 * @description ゴールの進捗状態を表す
 */
export type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * ゴール依存関係の参照先ゴール情報
 * @description 依存先ゴールの基本情報
 */
export interface GoalDependencyGoalInfo {
  /** ゴールID */
  id: string;
  /** ゴールタイトル */
  title: string;
  /** 所属プロジェクトID */
  project_id: string;
}

/**
 * ゴール依存関係
 * @description ゴール間の依存関係を定義
 */
export interface GoalDependency {
  /** 依存関係ID */
  id: string;
  /** 依存元ゴールID */
  goal_id: string;
  /** 依存先ゴールID */
  depends_on_goal_id: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 依存先ゴールの詳細情報 */
  depends_on_goal?: GoalDependencyGoalInfo;
}

/**
 * ゴール依存関係作成リクエスト
 * @description ゴール間の依存関係を作成するためのパラメータ
 */
export interface GoalDependencyCreate {
  /** 依存元ゴールID */
  goal_id: string;
  /** 依存先ゴールID */
  depends_on_goal_id: string;
}

/**
 * ゴール
 * @description ゴールの完全なデータ構造
 */
export interface Goal {
  /** ゴールID (UUID) */
  id: string;
  /** ゴールタイトル */
  title: string;
  /** ゴール説明 */
  description: string | null;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** ステータス */
  status: GoalStatus;
  /** 所属プロジェクトID */
  project_id: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 更新日時 (ISO 8601形式) */
  updated_at: string;
  /** 依存関係リスト */
  dependencies?: GoalDependency[];
}

/**
 * ゴール作成リクエスト
 * @description 新規ゴール作成時のパラメータ
 */
export interface GoalCreate {
  /** ゴールタイトル */
  title: string;
  /** ゴール説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 初期ステータス（デフォルト: pending） */
  status?: GoalStatus;
  /** 所属プロジェクトID */
  project_id: string;
}

/**
 * ゴール更新リクエスト
 * @description ゴール更新時のパラメータ（全フィールドオプショナル）
 */
export interface GoalUpdate {
  /** ゴールタイトル */
  title?: string;
  /** ゴール説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours?: number;
  /** ステータス */
  status?: GoalStatus;
}

/**
 * ゴールAPIレスポンス
 * @description 単一ゴール取得時のレスポンス形式
 */
export interface GoalResponse {
  /** ゴールID */
  id: string;
  /** ゴールタイトル */
  title: string;
  /** ゴール説明 */
  description: string | null;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** ステータス */
  status: GoalStatus;
  /** 所属プロジェクトID */
  project_id: string;
  /** 作成日時 */
  created_at: string;
  /** 更新日時 */
  updated_at: string;
}

/**
 * ゴール一覧APIレスポンス
 * @description ページネーション付きゴール一覧
 */
export interface GoalsApiResponse {
  /** ゴールデータ配列 */
  data: Goal[];
  /** 総件数 */
  total: number;
}

/**
 * ゴールフォームデータ
 * @description ゴール作成・編集フォームのデータ構造
 */
export interface GoalFormData {
  /** ゴールタイトル */
  title: string;
  /** ゴール説明 */
  description: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
}
