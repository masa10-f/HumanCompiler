// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { NumberInput, type NumberInputProps } from '../number-input'

function Harness({
  initial,
  onSpy,
  ...props
}: Omit<NumberInputProps, 'value' | 'onValueChange'> & {
  initial: number | undefined
  onSpy?: (value: number | undefined) => void
}) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <>
      <NumberInput
        aria-label="amount"
        value={value}
        onValueChange={(next) => {
          onSpy?.(next)
          setValue(next)
        }}
        {...props}
      />
      <button type="button" onClick={() => setValue(25)}>
        preset
      </button>
      <output data-testid="value">{value === undefined ? 'empty' : value}</output>
    </>
  )
}

const input = () => screen.getByLabelText('amount') as HTMLInputElement

describe('NumberInput', () => {
  it('lets the field be cleared while editing instead of filling in a fallback', () => {
    const onSpy = jest.fn()
    render(<Harness initial={30} min={1} onSpy={onSpy} />)

    fireEvent.change(input(), { target: { value: '' } })
    expect(input().value).toBe('')
    expect(onSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('value')).toHaveTextContent('30')

    fireEvent.change(input(), { target: { value: '45' } })
    expect(input().value).toBe('45')
    expect(onSpy).toHaveBeenLastCalledWith(45)
  })

  it('restores the last value when left empty without allowEmpty', () => {
    render(<Harness initial={30} />)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(input().value).toBe('30')
  })

  it('reports an empty field as undefined with allowEmpty', () => {
    const onSpy = jest.fn()
    render(<Harness initial={1.5} allowEmpty onSpy={onSpy} />)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(onSpy).toHaveBeenLastCalledWith(undefined)
    expect(input().value).toBe('')
    expect(screen.getByTestId('value')).toHaveTextContent('empty')
  })

  it('accepts 0 as an intermediate value and clamps it on blur', () => {
    const onSpy = jest.fn()
    render(<Harness initial={30} min={1} max={1440} integer clampOnBlur onSpy={onSpy} />)

    fireEvent.change(input(), { target: { value: '0' } })
    expect(input().value).toBe('0')

    fireEvent.blur(input())
    expect(onSpy).toHaveBeenLastCalledWith(1)
    expect(input().value).toBe('1')

    fireEvent.change(input(), { target: { value: '5000' } })
    fireEvent.blur(input())
    expect(input().value).toBe('1440')
  })

  it('clamps the restored value when an out-of-range field is cleared and left', () => {
    const onSpy = jest.fn()
    render(<Harness initial={30} min={5} max={480} integer clampOnBlur onSpy={onSpy} />)

    fireEvent.change(input(), { target: { value: '5000' } })
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(onSpy).toHaveBeenLastCalledWith(480)
    expect(input().value).toBe('480')
    expect(screen.getByTestId('value')).toHaveTextContent('480')
  })

  it('reads scientific notation as the whole number in integer fields', () => {
    const onSpy = jest.fn()
    render(<Harness initial={30} min={5} max={480} integer clampOnBlur onSpy={onSpy} />)

    fireEvent.change(input(), { target: { value: '1e2' } })
    expect(onSpy).toHaveBeenLastCalledWith(100)
    fireEvent.blur(input())
    expect(screen.getByTestId('value')).toHaveTextContent('100')
  })

  it('shows the whole number kept when a fraction is typed into an integer field', () => {
    render(<Harness initial={30} integer />)

    fireEvent.change(input(), { target: { value: '12.7' } })
    fireEvent.blur(input())
    expect(input().value).toBe('12')
    expect(screen.getByTestId('value')).toHaveTextContent('12')
  })

  it('follows values set from outside', () => {
    render(<Harness initial={30} />)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.click(screen.getByText('preset'))
    expect(input().value).toBe('25')
  })
})
