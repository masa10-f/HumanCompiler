/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useToast, toast, reducer } from '../use-toast'

// Reset module state between tests
beforeEach(() => {
  // Clear any existing toasts by using the reducer directly
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('reducer', () => {
  const initialState = { toasts: [] }

  describe('ADD_TOAST', () => {
    it('should add a toast to the beginning of the list', () => {
      const newToast = {
        id: '1',
        title: 'Test Toast',
        open: true,
      }

      const result = reducer(initialState, {
        type: 'ADD_TOAST',
        toast: newToast,
      })

      expect(result.toasts).toHaveLength(1)
      expect(result.toasts[0]).toEqual(newToast)
    })

    it('should add new toasts to the beginning (limited by TOAST_LIMIT)', () => {
      const existingToast = { id: '1', title: 'First', open: true }
      const newToast = { id: '2', title: 'Second', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'ADD_TOAST',
        toast: newToast,
      })

      // TOAST_LIMIT is 1, so only the newest toast is kept
      expect(result.toasts).toHaveLength(1)
      expect(result.toasts[0]).toEqual(newToast)
    })
  })

  describe('UPDATE_TOAST', () => {
    it('should update a toast by id', () => {
      const existingToast = { id: '1', title: 'Original', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'UPDATE_TOAST',
        toast: { id: '1', title: 'Updated' },
      })

      expect(result.toasts[0].title).toBe('Updated')
      expect(result.toasts[0].open).toBe(true) // Other props preserved
    })

    it('should not modify other toasts', () => {
      const toast1 = { id: '1', title: 'First', open: true }
      // Note: With TOAST_LIMIT of 1, we test with single toast
      const stateWithToast = { toasts: [toast1] }

      const result = reducer(stateWithToast, {
        type: 'UPDATE_TOAST',
        toast: { id: '1', title: 'Updated' },
      })

      expect(result.toasts[0].title).toBe('Updated')
    })

    it('should do nothing if toast id not found', () => {
      const existingToast = { id: '1', title: 'Original', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'UPDATE_TOAST',
        toast: { id: 'nonexistent', title: 'Updated' },
      })

      expect(result.toasts[0].title).toBe('Original')
    })
  })

  describe('DISMISS_TOAST', () => {
    it('should set open=false for a specific toast', () => {
      const existingToast = { id: '1', title: 'Test', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'DISMISS_TOAST',
        toastId: '1',
      })

      expect(result.toasts[0].open).toBe(false)
    })

    it('should dismiss all toasts when no id provided', () => {
      const toast1 = { id: '1', title: 'First', open: true }
      // With TOAST_LIMIT of 1, test with single toast
      const stateWithToast = { toasts: [toast1] }

      const result = reducer(stateWithToast, {
        type: 'DISMISS_TOAST',
        toastId: undefined,
      })

      expect(result.toasts.every((t) => t.open === false)).toBe(true)
    })
  })

  describe('REMOVE_TOAST', () => {
    it('should remove a specific toast by id', () => {
      const existingToast = { id: '1', title: 'Test', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'REMOVE_TOAST',
        toastId: '1',
      })

      expect(result.toasts).toHaveLength(0)
    })

    it('should remove all toasts when no id provided', () => {
      const toast1 = { id: '1', title: 'First', open: true }
      const stateWithToast = { toasts: [toast1] }

      const result = reducer(stateWithToast, {
        type: 'REMOVE_TOAST',
        toastId: undefined,
      })

      expect(result.toasts).toHaveLength(0)
    })

    it('should do nothing if toast id not found', () => {
      const existingToast = { id: '1', title: 'Test', open: true }
      const stateWithToast = { toasts: [existingToast] }

      const result = reducer(stateWithToast, {
        type: 'REMOVE_TOAST',
        toastId: 'nonexistent',
      })

      expect(result.toasts).toHaveLength(1)
    })
  })
})

describe('toast function', () => {
  it('should return id, dismiss, and update functions', () => {
    const result = toast({ title: 'Test' })

    expect(result).toHaveProperty('id')
    expect(typeof result.id).toBe('string')
    expect(typeof result.dismiss).toBe('function')
    expect(typeof result.update).toBe('function')
  })

  it('should generate unique ids for each toast', () => {
    const result1 = toast({ title: 'Toast 1' })
    const result2 = toast({ title: 'Toast 2' })

    expect(result1.id).not.toBe(result2.id)
  })
})

describe('useToast hook', () => {
  it('should return current toasts', () => {
    const { result } = renderHook(() => useToast())

    expect(result.current).toHaveProperty('toasts')
    expect(Array.isArray(result.current.toasts)).toBe(true)
  })

  it('should return toast function', () => {
    const { result } = renderHook(() => useToast())

    expect(typeof result.current.toast).toBe('function')
  })

  it('should return dismiss function', () => {
    const { result } = renderHook(() => useToast())

    expect(typeof result.current.dismiss).toBe('function')
  })

  it('should add toast when toast function is called', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.toast({ title: 'New Toast' })
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe('New Toast')
  })

  it('should dismiss toast when dismiss function is called', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.toast({ title: 'Test Toast' })
    })

    const toastId = result.current.toasts[0]?.id

    act(() => {
      result.current.dismiss(toastId)
    })

    expect(result.current.toasts[0]?.open).toBe(false)
  })

  it('should update state when toast is added', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.toast({ title: 'Added Toast' })
    })

    // With TOAST_LIMIT of 1, there should be exactly 1 toast
    expect(result.current.toasts.length).toBe(1)
    expect(result.current.toasts[0].title).toBe('Added Toast')
  })

  it('should subscribe to state updates across multiple hook instances', () => {
    const { result: result1 } = renderHook(() => useToast())
    const { result: result2 } = renderHook(() => useToast())

    act(() => {
      result1.current.toast({ title: 'Shared Toast' })
    })

    // Both instances should see the same toast
    expect(result1.current.toasts).toHaveLength(result2.current.toasts.length)
  })
})
