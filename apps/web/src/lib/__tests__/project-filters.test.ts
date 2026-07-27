// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  getGoalProjectIds,
  getOpenProjects,
  getSelectableProjects,
  isOpenProject,
  isSelectableProject,
  MAX_GOAL_PROJECT_QUERIES,
} from '@/lib/project-filters'
import type { ProjectStatus } from '@/types/project'

const projects = [
  { id: 'pending', status: 'pending' as const },
  { id: 'in-progress', status: 'in_progress' as const },
  { id: 'completed', status: 'completed' as const },
  { id: 'cancelled', status: 'cancelled' as const },
]

describe('project filters', () => {
  it.each([
    ['pending', true],
    ['in_progress', true],
    ['completed', false],
    ['cancelled', false],
  ] as const)('classifies %s projects as open=%s', (status, expected) => {
    expect(isOpenProject({ status: status as ProjectStatus })).toBe(expected)
  })

  it('returns only projects that can still receive active work', () => {
    expect(getOpenProjects(projects).map((project) => project.id)).toEqual([
      'pending',
      'in-progress',
    ])
  })

  it('loads goals only for open projects by default', () => {
    expect(getGoalProjectIds(projects)).toEqual(['pending', 'in-progress'])
  })

  it('also loads goals for a selected archived project', () => {
    expect(getGoalProjectIds(projects, 'completed')).toEqual([
      'pending',
      'in-progress',
      'completed',
    ])
  })

  it('caps goal query fan-out while prioritizing the selected project', () => {
    const manyProjects = Array.from(
      { length: MAX_GOAL_PROJECT_QUERIES + 1 },
      (_, index) => ({
        id: `project-${index}`,
        status: 'in_progress' as const,
      }),
    )

    const projectIds = getGoalProjectIds(
      manyProjects,
      'archived-project',
    )

    expect(projectIds).toHaveLength(MAX_GOAL_PROJECT_QUERIES)
    expect(projectIds).toContain('archived-project')
    expect(projectIds).not.toContain(
      `project-${MAX_GOAL_PROJECT_QUERIES - 1}`,
    )
  })

  it('keeps selectable projects limited to in-progress work', () => {
    expect(isSelectableProject({ status: 'in_progress' })).toBe(true)
    expect(isSelectableProject({ status: 'pending' })).toBe(false)
    expect(getSelectableProjects(projects).map((project) => project.id)).toEqual([
      'in-progress',
    ])
  })
})
