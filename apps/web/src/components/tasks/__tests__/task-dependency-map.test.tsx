// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'

jest.mock('d3-selection', () => ({
  select: jest.fn(() => ({ call: jest.fn(), on: jest.fn() })),
}))
jest.mock('d3-zoom', () => ({
  zoom: jest.fn(() => ({ scaleExtent: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis() })),
  zoomIdentity: {
    translate: jest.fn().mockReturnThis(),
    scale: jest.fn().mockReturnThis(),
    toString: () => '',
  },
}))

import { TaskDependencyMap } from '../task-dependency-map'

describe('TaskDependencyMap', () => {
  it('asks for narrower filters instead of silently truncating a large graph', () => {
    render(
      <TaskDependencyMap
        graph={{
          nodes: [],
          edges: [],
          total: 201,
          node_count: 214,
          exceeds_limit: true,
          limit: 200,
        }}
        isLoading={false}
        isError={false}
        selectedTaskId={null}
        onSelectTask={jest.fn()}
      />,
    )

    expect(screen.getByText('表示対象が多すぎます')).toBeInTheDocument()
    expect(screen.getByText(/214 件あります/)).toBeInTheDocument()
    expect(screen.getByText(/200 件以下/)).toBeInTheDocument()
  })
})
