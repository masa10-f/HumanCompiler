/**
 * @fileoverview プロジェクト関連の型定義
 * @description プロジェクトの状態管理、CRUD操作の型を定義
 */

/**
 * プロジェクトのステータス
 * @description プロジェクトの進捗状態を表す
 */
export type ProjectStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * プロジェクト
 * @description プロジェクトの完全なデータ構造
 */
export interface Project {
  /** プロジェクトID (UUID) */
  id: string;
  /** プロジェクトタイトル */
  title: string;
  /** プロジェクト説明 */
  description: string | null;
  /** ステータス */
  status: ProjectStatus;
  /** オーナーユーザーID */
  owner_id: string;
  /** 作成日時 (ISO 8601形式) */
  created_at: string;
  /** 更新日時 (ISO 8601形式) */
  updated_at: string;
}

/**
 * プロジェクト作成リクエスト
 * @description 新規プロジェクト作成時のパラメータ
 */
export interface ProjectCreate {
  /** プロジェクトタイトル */
  title: string;
  /** プロジェクト説明 */
  description?: string;
  /** 初期ステータス */
  status: ProjectStatus;
}

/**
 * プロジェクト更新リクエスト
 * @description プロジェクト更新時のパラメータ（全フィールドオプショナル）
 */
export interface ProjectUpdate {
  /** プロジェクトタイトル */
  title?: string;
  /** プロジェクト説明 */
  description?: string;
  /** ステータス */
  status?: ProjectStatus;
}

/**
 * プロジェクトAPIレスポンス
 * @description 単一プロジェクト取得時のレスポンス形式
 */
export interface ProjectResponse {
  /** プロジェクトID */
  id: string;
  /** プロジェクトタイトル */
  title: string;
  /** プロジェクト説明 */
  description: string | null;
  /** ステータス */
  status: ProjectStatus;
  /** オーナーユーザーID */
  owner_id: string;
  /** 作成日時 */
  created_at: string;
  /** 更新日時 */
  updated_at: string;
}

/**
 * プロジェクト一覧APIレスポンス
 * @description ページネーション付きプロジェクト一覧
 */
export interface ProjectsApiResponse {
  /** プロジェクトデータ配列 */
  data: Project[];
  /** 総件数 */
  total: number;
}

/**
 * プロジェクトフォームデータ
 * @description プロジェクト作成・編集フォームのデータ構造
 */
export interface ProjectFormData {
  /** プロジェクトタイトル */
  title: string;
  /** プロジェクト説明 */
  description: string;
}
