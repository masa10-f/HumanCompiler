// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  getOpenProjects,
  getSelectableProjects,
  isOpenProject,
  isSelectableProject,
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

  it('keeps selectable projects limited to in-progress work', () => {
    expect(isSelectableProject({ status: 'in_progress' })).toBe(true)
    expect(isSelectableProject({ status: 'pending' })).toBe(false)
    expect(getSelectableProjects(projects).map((project) => project.id)).toEqual([
      'in-progress',
    ])
  })
})
