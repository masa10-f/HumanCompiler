/**
 * @fileoverview AI計画関連の型定義
 * @description AI支援による週次計画・スケジュール最適化に使用する型を定義
 */

/**
 * 週次計画リクエスト
 * @description AI週次計画生成時のパラメータ
 */
export interface WeeklyPlanRequest {
  /** 週の開始日 (ISO 8601形式、月曜日) */
  week_start_date: string;
  /** 週の作業キャパシティ（時間単位） */
  capacity_hours: number;
  /** フィルター対象プロジェクトID一覧 */
  project_filter?: string[];
  /** 選択された定期タスクID一覧 */
  selected_recurring_task_ids?: string[];
  /** プロジェクト別時間配分（キー: プロジェクトID, 値: 時間） */
  project_allocations?: Record<string, number>;
  /** その他の設定 */
  preferences?: Record<string, unknown>;
  /** ユーザーからの追加指示 */
  user_prompt?: string;
  /** AI優先度付けを使用するか */
  use_ai_priority?: boolean;
}

/**
 * タスク計画
 * @description AI計画による個別タスクの割り当て情報
 */
export interface TaskPlan {
  /** タスクID */
  task_id: string;
  /** タスクタイトル */
  task_title: string;
  /** 見積もり時間（時間単位）- 残り時間（見積もり - 実績）を表す */
  estimated_hours: number;
  /** 優先度 (1:最高 〜 5:最低) */
  priority: number;
  /** 割り当て理由・根拠 */
  rationale: string;
}

/**
 * ソルバーメトリクス
 * @description OR-Tools最適化エンジンの実行結果メトリクス
 */
export interface SolverMetrics {
  /** キャパシティ使用率（0-100%） */
  capacity_utilization?: number;
  /** プロジェクトバランススコア */
  project_balance_score?: number;
  /** 関与プロジェクト数 */
  projects_involved?: number;
  /** 平均タスク時間 */
  avg_task_hours?: number;
  /** タスク数 */
  task_count?: number;
  /** プロジェクト別配分（キー: プロジェクトID, 値: 時間） */
  project_distribution?: Record<string, number>;
  /** その他のメトリクス */
  [key: string]: unknown;
}

/**
 * 制約分析
 * @description ソルバーによる制約条件の分析結果
 */
export interface ConstraintAnalysis {
  /** キャパシティ使用率（0-100%） */
  capacity_utilization?: number;
  /** 緊急タスク数 */
  urgent_task_count?: number;
  /** 過負荷リスクがあるか */
  overload_risk?: boolean;
  /** その他の分析結果 */
  [key: string]: unknown;
}

/**
 * 週次計画レスポンス
 * @description AI週次計画の生成結果
 */
export interface WeeklyPlanResponse {
  /** 成功したかどうか */
  success: boolean;
  /** 週の開始日 */
  week_start_date: string;
  /** 総計画時間（時間単位） */
  total_planned_hours: number;
  /** タスク計画一覧 */
  task_plans: TaskPlan[];
  /** AI推奨事項 */
  recommendations: string[];
  /** AIインサイト */
  insights: string[];
  /** プロジェクト別配分 */
  project_allocations?: ProjectAllocation[];
  /** 制約分析結果 */
  constraint_analysis?: ConstraintAnalysis;
  /** ソルバーメトリクス */
  solver_metrics?: SolverMetrics;
  /** 生成日時 (ISO 8601形式) */
  generated_at: string;
}

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
  kind: 'study' | 'focused_work' | 'light_work';
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
  type: 'all_tasks' | 'project' | 'weekly_schedule';
  /** プロジェクトID（type='project'の場合） */
  project_id?: string;
  /** 週次スケジュール日付（type='weekly_schedule'の場合） */
  weekly_schedule_date?: string;
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
  /** 週次スケジュールを使用するか（レガシー互換） */
  use_weekly_schedule?: boolean;
  /** その他の設定 */
  preferences?: Record<string, unknown>;
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
  slot_kind: string;
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
  kind: string;
  /** 期限日 */
  due_date?: string;
  /** 所属ゴールID */
  goal_id?: string;
  /** 所属プロジェクトID */
  project_id?: string;
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

/**
 * 週次スケジュールデータ
 * @description 保存される週次スケジュールの内容
 */
export interface WeeklyScheduleData {
  /** 成功したかどうか */
  success: boolean;
  /** 週の開始日 */
  week_start_date: string;
  /** 選択されたタスク一覧 */
  selected_tasks: TaskPlan[];
  /** 総配分時間（時間単位） */
  total_allocated_hours: number;
  /** プロジェクト別配分 */
  project_allocations: ProjectAllocation[];
  /** 最適化インサイト */
  optimization_insights: string[];
  /** 制約分析結果 */
  constraint_analysis: ConstraintAnalysis;
  /** ソルバーメトリクス */
  solver_metrics: SolverMetrics;
  /** 生成日時 (ISO 8601形式) */
  generated_at: string;
}

/**
 * プロジェクト配分
 * @description プロジェクトごとの時間配分設定
 */
export interface ProjectAllocation {
  /** プロジェクトID */
  project_id: string;
  /** プロジェクトタイトル */
  project_title: string;
  /** 目標時間（時間単位） */
  target_hours: number;
  /** 最大時間（時間単位） */
  max_hours: number;
  /** 優先度重み */
  priority_weight: number;
}

/**
 * 保存済み週次スケジュール
 * @description データベースに保存された週次スケジュール
 */
export interface SavedWeeklySchedule {
  /** スケジュールID */
  id: string;
  /** ユーザーID */
  user_id: string;
  /** 週の開始日 */
  week_start_date: string;
  /** スケジュールJSON */
  schedule_json: WeeklyScheduleData;
  /** 作成日時 */
  created_at: string;
  /** 更新日時 */
  updated_at: string;
}

/**
 * 週次スケジュール選択肢
 * @description 週次スケジュール選択UIで使用する選択肢
 */
export interface WeeklyScheduleOption {
  /** 週の開始日 */
  week_start_date: string;
  /** タスク数 */
  task_count: number;
  /** 表示タイトル */
  title: string;
}
