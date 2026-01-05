/**
 * @fileoverview ソート関連の型定義
 * @description API一覧取得時のソートオプションを定義
 */

/**
 * ソート対象フィールド
 * @description 一覧取得APIで使用可能なソート対象
 */
export enum SortBy {
  /** ステータスでソート */
  STATUS = 'status',
  /** タイトルでソート */
  TITLE = 'title',
  /** 作成日時でソート */
  CREATED_AT = 'created_at',
  /** 更新日時でソート */
  UPDATED_AT = 'updated_at',
  /** 優先度でソート */
  PRIORITY = 'priority',
}

/**
 * ソート順序
 * @description 昇順または降順を指定
 */
export enum SortOrder {
  /** 昇順 (A→Z, 1→9, 古い→新しい) */
  ASC = 'asc',
  /** 降順 (Z→A, 9→1, 新しい→古い) */
  DESC = 'desc',
}

/**
 * ソートオプション
 * @description 一覧取得時のソート設定
 */
export interface SortOptions {
  /** ソート対象フィールド */
  sortBy?: SortBy;
  /** ソート順序 */
  sortOrder?: SortOrder;
}
