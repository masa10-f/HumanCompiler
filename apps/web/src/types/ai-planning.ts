/**
 * @fileoverview AI計画・スケジュール関連の型定義
 * @description 作業負荷分析・日次スケジュール最適化に使用する型を定義
 */

import type { SlotKind } from "@/constants/schedule";
import type { WorkType } from "./task";

/**
 * 作業負荷分析
 * @description 現在の作業負荷の分析結果
 */
export interface WorkloadAnalysis {
  /** 成功したかどうか */
  success: boolean;
  /** 分析結果 */
  analysis: {
    /** 総見積もり時間（時間単位） */
    total_estimated_hours: number;
    /** 総タスク数 */
    total_tasks: number;
    /** 期限超過タスク数 */
    overdue_tasks: number;
    /** 緊急タスク数 */
    urgent_tasks: number;
    /** 関与プロジェクト数 */
    projects_involved: number;
    /** プロジェクト別配分（キー: プロジェクトID, 値: 時間） */
    project_distribution: Record<string, number>;
  };
  /** AI推奨事項 */
  recommendations: string[];
  /** 生成日時 (ISO 8601形式) */
  generated_at: string;
}

/**
 * タスク優先度提案
 * @description AIによる個別タスクの優先度変更提案
 */
export interface TaskPrioritySuggestion {
  /** タスクID */
  task_id: string;
  /** タスクタイトル */
  task_title: string;
  /** 現在の見積もり時間（時間単位） */
  current_estimate_hours: number;
  /** 期限日 */
  due_date?: string;
  /** 優先度スコア（内部計算値） */
  priority_score: number;
  /** 提案優先度 (1:最高 〜 5:最低) */
  suggested_priority: number;
  /** 提案理由 */
  reasoning: string[];
}

/**
 * 優先度提案一覧
 * @description AIによる優先度変更提案の一覧
 */
export interface PrioritySuggestions {
  /** 成功したかどうか */
  success: boolean;
  /** 分析対象タスク数 */
  total_tasks_analyzed: number;
  /** 優先度提案一覧 */
  priority_suggestions: TaskPrioritySuggestion[];
  /** 優先度付け方法論 */
  methodology: {
    /** 考慮要素 */
    factors: string[];
    /** 優先度スケール説明 */
    priority_scale: string;
  };
  /** 生成日時 (ISO 8601形式) */
  generated_at: string;
}

/**
 * タイムスロット
 * @description 1日の中の作業時間帯
 */
export interface TimeSlot {
  /** 開始時刻 (HH:mm形式) */
  start: string;
  /** 終了時刻 (HH:mm形式) */
  end: string;
  /** スロット種別（作業タイプ） */
  kind: SlotKind;
  /** スロットのキャパシティ（時間単位） */
  capacity_hours?: number;
  /** 割り当てプロジェクトID（スロット単位での割り当て） */
  assigned_project_id?: string;
}

/**
 * タスクソース
 * @description スケジュール対象タスクの取得元
 */
export interface TaskSource {
  /** ソースタイプ */
  type: "all_tasks" | "project";
  /** プロジェクトID（type='project'の場合） */
  project_id?: string;
}

/**
 * スケジュールリクエスト
 * @description 日次スケジュール最適化のリクエスト
 */
export interface ScheduleRequest {
  /** 対象日付 (ISO 8601形式) */
  date: string;
  /** タイムスロット一覧 */
  time_slots: TimeSlot[];
  /** タスクソース設定 */
  task_source?: TaskSource;
  /** プロジェクトID（レガシー互換） */
  project_id?: string;
  /** その他の設定 */
  preferences?: Record<string, unknown>;
  /** Scheduler solver parameter overrides */
  solver_config?: SchedulerSolverConfig;
  /** ユーザーが手動で配置した固定割り当て */
  fixed_assignments?: FixedAssignment[];
}

export interface SchedulerSolverConfig {
  kind_match_score?: number;
  kind_mismatch_score?: number;
  priority_score_base?: number;
  deadline_soon_days?: number;
  deadline_score?: number;
  overdue_score?: number;
  min_block_minutes?: number;
  block_granularity_minutes?: number;
  max_candidate_block_minutes?: number;
  project_switch_penalty?: number;
  project_switch_reset_gap_minutes?: number;
  long_continuous_threshold_minutes?: number;
  long_continuous_penalty?: number;
  break_reset_gap_minutes?: number;
  small_gap_minutes?: number;
  small_gap_fill_score?: number;
}

export interface SchedulerConfigControl {
  key: keyof SchedulerSolverConfig;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  visibility: "essential" | "tuning" | "expert";
  help: string;
}

export interface SchedulerTuningConfig {
  backend_package: string;
  backend_version: string;
  defaults: SchedulerSolverConfig;
  schema: SchedulerConfigControl[];
}

/**
 * タスク割り当て
 * @description スケジュール最適化による個別タスクの時間割り当て
 */
export interface TaskAssignment {
  /** タスクID */
  task_id: string;
  /** タスクタイトル */
  task_title: string;
  /** 所属ゴールID */
  goal_id: string;
  /** 所属プロジェクトID */
  project_id: string;
  /** 割り当てスロットインデックス */
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
  slot_kind: SlotKind;
  /** ユーザーによる固定割り当てかどうか */
  is_fixed?: boolean;
}

/**
 * タスク情報
 * @description スケジュール用のタスク基本情報
 */
export interface TaskInfo {
  /** タスクID */
  id: string;
  /** タスクタイトル */
  title: string;
  /** 見積もり時間（時間単位）- 実際は残り時間（見積もり - 実績） */
  estimate_hours: number;
  /** 優先度 */
  priority: number;
  /** 作業種別 */
  kind: WorkType;
  /** 期限日 */
  due_date?: string;
  /** 所属ゴールID */
  goal_id?: string;
  /** 所属プロジェクトID */
  project_id?: string;
}

/**
 * 固定割り当て
 * @description ユーザーが手動でスロットに割り当てたタスク
 */
export interface FixedAssignment {
  /** タスクID */
  task_id: string;
  /** 割り当てスロットインデックス */
  slot_index: number;
  /** 割り当て時間（時間単位、省略時はタスクの残り時間を使用） */
  duration_hours?: number;
}

/**
 * スケジュール結果
 * @description 日次スケジュール最適化の結果
 */
export interface ScheduleResult {
  /** 成功したかどうか */
  success: boolean;
  /** タスク割り当て一覧 */
  assignments: TaskAssignment[];
  /** 未スケジュールタスク一覧 */
  unscheduled_tasks: TaskInfo[];
  /** 総スケジュール時間（時間単位） */
  total_scheduled_hours: number;
  /** 最適化ステータス */
  optimization_status: string;
  /** 解決時間（秒） */
  solve_time_seconds: number;
  /** 目的関数値 */
  objective_value?: number;
}
