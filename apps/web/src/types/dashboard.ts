// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type { GoalStatus } from '@/types/goal';
import type { TaskStatus } from '@/types/task';

export type RecentDashboardItemKind = 'task' | 'goal';

export interface RecentDashboardItem {
  kind: RecentDashboardItemKind;
  id: string;
  title: string;
  status: TaskStatus | GoalStatus;
  project_id: string;
  project_title: string;
  goal_id: string;
  goal_title: string;
  updated_at: string;
}
