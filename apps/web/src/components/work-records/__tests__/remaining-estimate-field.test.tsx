// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { fireEvent, render, screen } from '@testing-library/react'

import {
  REMAINING_HOURS_TOO_LARGE,
  REMAINING_HOURS_TOO_SMALL,
  RemainingEstimateField,
  remainingHoursError,
} from '../remaining-estimate-field'

describe('remainingHoursError', () => {
  it('accepts an empty field and any value an estimate can hold', () => {
    expect(remainingHoursError(undefined)).toBeUndefined()
    expect(remainingHoursError(0)).toBeUndefined()
    expect(remainingHoursError(999.99)).toBeUndefined()
  })

  it('rejects what the API would reject', () => {
    expect(remainingHoursError(-0.5)).toBe(REMAINING_HOURS_TOO_SMALL)
    expect(remainingHoursError(1000)).toBe(REMAINING_HOURS_TOO_LARGE)
  })
})

describe('RemainingEstimateField', () => {
  it('reports the hours typed, and nothing for an empty field', () => {
    const onChange = jest.fn()
    render(<RemainingEstimateField id="remaining" value={undefined} onChange={onChange} />)
    const input = screen.getByLabelText('残りの見込み（時間・任意）')

    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).toHaveBeenLastCalledWith(1.5)

    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('reports an emptied field as no value', () => {
    const onChange = jest.fn()
    render(<RemainingEstimateField id="remaining" value={2} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('残りの見込み（時間・任意）'), {
      target: { value: '' },
    })

    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('shows the estimate the task has now, when it is known', () => {
    const { rerender } = render(
      <RemainingEstimateField id="remaining" value={undefined} onChange={jest.fn()} />,
    )
    expect(screen.queryByText(/現在の見積/)).not.toBeInTheDocument()

    rerender(
      <RemainingEstimateField
        id="remaining"
        value={undefined}
        onChange={jest.fn()}
        currentEstimateHours={4}
      />,
    )
    expect(screen.getByText('現在の見積: 4h')).toBeInTheDocument()
  })

  it('shows its error and can be disabled', () => {
    render(
      <RemainingEstimateField
        id="remaining"
        value={-1}
        onChange={jest.fn()}
        disabled
        error={REMAINING_HOURS_TOO_SMALL}
      />,
    )

    expect(screen.getByText(REMAINING_HOURS_TOO_SMALL)).toBeInTheDocument()
    expect(screen.getByLabelText('残りの見込み（時間・任意）')).toBeDisabled()
  })
})
