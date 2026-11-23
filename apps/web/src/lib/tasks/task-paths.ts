// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/** The page of one task: the full-width view of what the task panel shows. */
export function taskPagePath(projectId: string, goalId: string, taskId: string): string {
  return `/projects/${projectId}/goals/${goalId}/tasks/${taskId}`;
}
