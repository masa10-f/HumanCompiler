/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock dependencies before importing the hook
const mockPush = jest.fn()
const mockPathname = jest.fn(() => '/dashboard')

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => mockPathname(),
}))

// Mock toast
const mockToast = jest.fn()
jest.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

// Mock Supabase
const mockGetSession = jest.fn()
const mockSignOut = jest.fn()
const mockOnAuthStateChange = jest.fn()

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) =>
        mockOnAuthStateChange(callback),
    },
  },
}))

// Import after mocks
import { useAuth } from '../use-auth'

describe('useAuth', () => {
  let authCallback: ((event: string, session: unknown) => void) | null = null

  beforeEach(() => {
    jest.clearAllMocks()
    authCallback = null

    // Default mock implementations
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
      error: null,
    })

    mockSignOut.mockResolvedValue({ error: null })

    mockOnAuthStateChange.mockImplementation((callback) => {
      authCallback = callback
      return {
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      }
    })

    mockPathname.mockReturnValue('/dashboard')
  })

  describe('initialization', () => {
    it('should start with loading=true', () => {
      mockGetSession.mockImplementation(() => new Promise(() => {})) // Never resolves
      const { result } = renderHook(() => useAuth())

      expect(result.current.loading).toBe(true)
    })

    it('should set loading=false after initial fetch', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
    })

    it('should fetch initial session on mount', async () => {
      renderHook(() => useAuth())

      await waitFor(() => {
        expect(mockGetSession).toHaveBeenCalled()
      })
    })

    it('should set user from initial session', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.user).toEqual({
          id: 'user-123',
          email: 'test@example.com',
        })
      })
    })

    it('should set user to null when no session', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.user).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    it('should return true when user exists', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true)
      })
    })

    it('should return false when user is null', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.isAuthenticated).toBe(false)
    })
  })

  describe('authentication state changes', () => {
    it('should update user on SIGNED_IN event', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Trigger sign in event
      act(() => {
        authCallback?.('SIGNED_IN', {
          user: { id: 'new-user', email: 'new@example.com' },
        })
      })

      expect(result.current.user).toEqual({
        id: 'new-user',
        email: 'new@example.com',
      })
    })

    it('should redirect to /dashboard on sign in from login page', async () => {
      mockPathname.mockReturnValue('/login')
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Trigger sign in event (after initial load)
      act(() => {
        authCallback?.('SIGNED_IN', {
          user: { id: 'user-123', email: 'test@example.com' },
        })
      })

      expect(mockPush).toHaveBeenCalledWith('/dashboard')
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'ログインしました',
        })
      )
    })

    it('should redirect to /dashboard on sign in from signup page', async () => {
      mockPathname.mockReturnValue('/signup')
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        authCallback?.('SIGNED_IN', {
          user: { id: 'user-123', email: 'test@example.com' },
        })
      })

      expect(mockPush).toHaveBeenCalledWith('/dashboard')
    })

    it('should redirect to /dashboard on sign in from root page', async () => {
      mockPathname.mockReturnValue('/')
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        authCallback?.('SIGNED_IN', {
          user: { id: 'user-123', email: 'test@example.com' },
        })
      })

      expect(mockPush).toHaveBeenCalledWith('/dashboard')
    })

    it('should NOT redirect on sign in if already on dashboard', async () => {
      mockPathname.mockReturnValue('/dashboard')
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        authCallback?.('SIGNED_IN', {
          user: { id: 'user-123', email: 'test@example.com' },
        })
      })

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should clear user on SIGNED_OUT event', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.user).not.toBeNull()
      })

      act(() => {
        authCallback?.('SIGNED_OUT', null)
      })

      expect(result.current.user).toBeNull()
    })

    it('should redirect to / on sign out', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        authCallback?.('SIGNED_OUT', null)
      })

      expect(mockPush).toHaveBeenCalledWith('/')
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'ログアウトしました',
        })
      )
    })
  })

  describe('signOut function', () => {
    it('should call supabase.auth.signOut', async () => {
      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockSignOut).toHaveBeenCalled()
    })

    it('should set loading during sign out', async () => {
      let resolveSignOut: () => void
      mockSignOut.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSignOut = () => resolve({ error: null })
          })
      )

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      act(() => {
        result.current.signOut()
      })

      expect(result.current.loading).toBe(true)

      await act(async () => {
        resolveSignOut!()
      })

      expect(result.current.loading).toBe(false)
    })

    it('should show error toast on sign out failure', async () => {
      const signOutError = new Error('Sign out failed')
      mockSignOut.mockResolvedValue({ error: signOutError })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signOut()
      })

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'エラー',
          variant: 'destructive',
        })
      )
    })
  })

  describe('cleanup', () => {
    it('should unsubscribe from auth changes on unmount', async () => {
      const mockUnsubscribe = jest.fn()
      mockOnAuthStateChange.mockImplementation((callback) => {
        authCallback = callback
        return {
          data: {
            subscription: {
              unsubscribe: mockUnsubscribe,
            },
          },
        }
      })

      const { unmount } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled()
      })

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalled()
    })
  })
})
