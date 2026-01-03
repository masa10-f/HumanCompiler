import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'

// Mock user factory
export const createMockUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }) as User

// Mock session factory
export const createMockSession = (overrides: Partial<Session> = {}): Session =>
  ({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: createMockUser(),
    ...overrides,
  }) as Session

// Auth state change callback type
type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void

// Store for auth callback
let authCallback: AuthCallback | null = null

// Create mock Supabase auth
export const createMockSupabaseAuth = () => ({
  getSession: jest.fn().mockResolvedValue({
    data: { session: createMockSession() },
    error: null,
  }),
  refreshSession: jest.fn().mockResolvedValue({
    data: { session: createMockSession() },
    error: null,
  }),
  signOut: jest.fn().mockResolvedValue({ error: null }),
  onAuthStateChange: jest.fn((callback: AuthCallback) => {
    authCallback = callback
    return {
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    }
  }),
})

// Main mock Supabase object
export const mockSupabaseAuth = createMockSupabaseAuth()

export const mockSupabase = {
  auth: mockSupabaseAuth,
}

// Helper to trigger auth events in tests
export const triggerAuthChange = (event: AuthChangeEvent, session: Session | null) => {
  if (authCallback) {
    authCallback(event, session)
  }
}

// Reset helper
export const resetSupabaseMocks = () => {
  authCallback = null
  mockSupabaseAuth.getSession.mockReset().mockResolvedValue({
    data: { session: createMockSession() },
    error: null,
  })
  mockSupabaseAuth.refreshSession.mockReset().mockResolvedValue({
    data: { session: createMockSession() },
    error: null,
  })
  mockSupabaseAuth.signOut.mockReset().mockResolvedValue({ error: null })
  mockSupabaseAuth.onAuthStateChange.mockReset().mockImplementation((callback: AuthCallback) => {
    authCallback = callback
    return {
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    }
  })
}

export default mockSupabase
