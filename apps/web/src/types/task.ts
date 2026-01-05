/**
 * @fileoverview タスク関連の型定義
 * @description タスクの状態管理、作業種別、依存関係などを定義
 */

/**
 * タスクのステータス
 * @description タスクの進捗状態を表す
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * 作業種別
 * @description タスクの作業タイプを分類
 * - light_work: 軽作業（メール確認、簡単な修正など）
 * - study: 学習（ドキュメント読み込み、調査など）
 * - focused_work: 集中作業（コーディング、設計など）
 */
export type WorkType = 'light_work' | 'study' | 'focused_work';

/**
 * タスク依存関係の参照先タスク情報
 * @description 依存先タスクの基本情報
 */
export interface TaskDependencyTaskInfo {
  /** タスクID */
  id: string;
  /** タスクタイトル */
  title: string;
  /** タスクステータス */
  status: TaskStatus;
}

/**
 * タスク依存関係
 * @description タスク間の依存関係を定義
 */
export interface TaskDependency {
  /** 依存関係ID */
  id: string;
  /** 依存元タスクID */
  task_id: string;
  /** 依存先タスクID */
  depends_on_task_id: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 依存先タスクの詳細情報 */
  depends_on_task?: TaskDependencyTaskInfo | null;
}

/**
 * タスク
 * @description タスクの完全なデータ構造
 */
export interface Task {
  /** タスクID (UUID) */
  id: string;
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description: string | null;
  /** メモ（作業中のメモなど） */
  memo?: string | null;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 期限日 (ISO 8601形式) */
  due_date: string | null;
  /** ステータス */
  status: TaskStatus;
  /** 作業種別 */
  work_type?: WorkType;
  /** 優先度 (1:最高 〜 5:最低) */
  priority: number;
  /** 所属ゴールID */
  goal_id: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 更新日時 (ISO 8601形式) */
  updated_at: string;
  /** 依存関係リスト */
  dependencies?: TaskDependency[];
}

/**
 * タスク作成リクエスト
 * @description 新規タスク作成時のパラメータ
 */
export interface TaskCreate {
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 期限日 (ISO 8601形式) */
  due_date?: string;
  /** 作業種別 */
  work_type?: WorkType;
  /** 優先度 (1:最高 〜 5:最低、デフォルト:3) */
  priority?: number;
  /** 所属ゴールID */
  goal_id: string;
}

/**
 * タスク更新リクエスト
 * @description タスク更新時のパラメータ（全フィールドオプショナル）
 */
export interface TaskUpdate {
  /** タスクタイトル */
  title?: string;
  /** タスク説明 */
  description?: string;
  /** メモ */
  memo?: string;
  /** 見積もり時間（時間単位） */
  estimate_hours?: number;
  /** 期限日 (ISO 8601形式) */
  due_date?: string;
  /** ステータス */
  status?: TaskStatus;
  /** 作業種別 */
  work_type?: WorkType;
  /** 優先度 (1:最高 〜 5:最低) */
  priority?: number;
}

/**
 * タスクAPIレスポンス
 * @description 単一タスク取得時のレスポンス形式
 */
export interface TaskResponse {
  /** タスクID */
  id: string;
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description: string | null;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 期限日 */
  due_date: string | null;
  /** ステータス */
  status: TaskStatus;
  /** 所属ゴールID */
  goal_id: string;
  /** 作成日時 */
  created_at: string;
  /** 更新日時 */
  updated_at: string;
}

/**
 * タスク一覧APIレスポンス
 * @description ページネーション付きタスク一覧
 */
export interface TasksApiResponse {
  /** タスクデータ配列 */
  data: Task[];
  /** 総件数 */
  total: number;
}

/**
 * タスクフォームデータ
 * @description タスク作成・編集フォームのデータ構造
 */
export interface TaskFormData {
  /** タスクタイトル */
  title: string;
  /** タスク説明 */
  description: string;
  /** 見積もり時間（時間単位） */
  estimate_hours: number;
  /** 期限日 */
  due_date: string;
}

/**
 * タスクステータスの日本語ラベル
 */
export const taskStatusLabels: Record<TaskStatus, string> = {
  pending: '未着手',
  in_progress: '進行中',
  completed: '完了',
  cancelled: 'キャンセル',
};

/**
 * タスクステータスのTailwind CSSカラークラス
 */
export const taskStatusColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

/**
 * 作業種別の日本語ラベル
 */
export const workTypeLabels: Record<WorkType, string> = {
  light_work: '軽作業',
  study: '学習',
  focused_work: '集中作業',
};

/**
 * 作業種別のTailwind CSSカラークラス
 */
export const workTypeColors: Record<WorkType, string> = {
  light_work: 'bg-yellow-100 text-yellow-800',
  study: 'bg-purple-100 text-purple-800',
  focused_work: 'bg-orange-100 text-orange-800',
};

/**
 * 優先度の日本語ラベル
 */
export const taskPriorityLabels: Record<number, string> = {
  1: '最高',
  2: '高',
  3: '中',
  4: '低',
  5: '最低',
};

/**
 * 優先度のTailwind CSSカラークラス
 */
export const taskPriorityColors: Record<number, string> = {
  1: 'bg-red-100 text-red-800',
  2: 'bg-orange-100 text-orange-800',
  3: 'bg-yellow-100 text-yellow-800',
  4: 'bg-blue-100 text-blue-800',
  5: 'bg-gray-100 text-gray-800',
};
