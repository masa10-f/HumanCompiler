/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockPush = jest.fn()
const mockSecureFetch = jest.fn()
const mockGetHookTokens = jest.fn()
const mockCreateHookToken = jest.fn()
const mockRevokeHookToken = jest.fn()
const mockGetUser = jest.fn()
const mockGetSession = jest.fn()
const mockClipboardWriteText = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('@/lib/api', () => ({
  secureFetch: (...args: unknown[]) => mockSecureFetch(...args),
  hookTokensApi: {
    getAll: () => mockGetHookTokens(),
    create: (data: unknown) => mockCreateHookToken(data),
    revoke: (tokenId: string) => mockRevokeHookToken(tokenId),
  },
}))

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      getSession: () => mockGetSession(),
    },
  },
}))

jest.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <header>App Header</header>,
}))

jest.mock('@/components/triage/triage-settings-card', () => ({
  TriageSettingsCard: () => <section>Triage Settings</section>,
}))

jest.mock('@/components/ui/confirmation-modal', () => ({
  ConfirmationModal: ({
    isOpen,
    onConfirm,
    title,
    confirmText,
  }: {
    isOpen: boolean
    onConfirm: () => void
    title: string
    confirmText?: string
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmText ?? '確認'}</button>
      </div>
    ) : null,
}))

import SettingsPage from '../page'

const jsonResponse = (data: unknown, ok = true) =>
  ({
    ok,
    json: jest.fn().mockResolvedValue(data),
  }) as unknown as Response

const defaultSettings = {
  has_api_key: false,
  openai_model: 'gpt-5.5',
  email_notifications_enabled: false,
  email_deadline_reminder_hours: 24,
  email_overdue_alerts_enabled: true,
  email_daily_digest_enabled: false,
  email_daily_digest_hour: 9,
}

const defaultExportInfo = {
  current_data_summary: {
    projects: 0,
    goals: 0,
    tasks: 0,
    quick_tasks: 0,
    schedules: 0,
    weekly_schedules: 0,
  },
}

describe('SettingsPage hook tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    })

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
    })
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    })
    mockSecureFetch.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/user/models') {
        return Promise.resolve(
          jsonResponse({
            models: {
              'gpt-5.5': {
                name: 'GPT-5.5',
                description: 'Model',
                max_context: '400k',
                max_output: '128k',
                modalities: ['text'],
              },
            },
          })
        )
      }
      if (endpoint === '/api/user/settings') {
        return Promise.resolve(jsonResponse(defaultSettings))
      }
      if (endpoint === '/api/export/info') {
        return Promise.resolve(jsonResponse(defaultExportInfo))
      }
      return Promise.resolve(jsonResponse({}))
    })
    mockGetHookTokens.mockResolvedValue([])
    mockCreateHookToken.mockResolvedValue({
      id: 'token-1',
      user_id: 'user-1',
      name: 'PR review',
      token_prefix: 'hc_hook_created',
      token: 'hc_hook_created_secret',
      last_used_at: null,
      created_at: '2026-07-07T00:00:00Z',
      updated_at: '2026-07-07T00:00:00Z',
    })
    mockRevokeHookToken.mockResolvedValue(undefined)
    mockClipboardWriteText.mockResolvedValue(undefined)
  })

  it('creates a hook token and shows the one-time secret for copying', async () => {
    render(<SettingsPage />)

    await screen.findByText('Hook Tokens')
    fireEvent.change(screen.getByPlaceholderText('Token name'), {
      target: { value: 'PR review' },
    })
    fireEvent.click(screen.getByRole('button', { name: /作成/ }))

    await waitFor(() => {
      expect(mockCreateHookToken).toHaveBeenCalledWith({ name: 'PR review' })
    })
    expect(screen.getByText('hc_hook_created_secret')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /コピー/ }))

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith(
        'hc_hook_created_secret'
      )
    })
  })

  it('revokes an existing hook token from the settings list', async () => {
    mockGetHookTokens.mockResolvedValue([
      {
        id: 'token-1',
        user_id: 'user-1',
        name: 'Paper intake',
        token_prefix: 'hc_hook_paper',
        last_used_at: null,
        created_at: '2026-07-07T00:00:00Z',
        updated_at: '2026-07-07T00:00:00Z',
      },
    ])

    render(<SettingsPage />)

    await screen.findByText('Paper intake')
    fireEvent.click(screen.getByRole('button', { name: /失効/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Hook tokenを失効' })).getByRole(
        'button',
        { name: '失効' }
      )
    )

    await waitFor(() => {
      expect(mockRevokeHookToken).toHaveBeenCalledWith('token-1')
    })
    expect(screen.queryByText('Paper intake')).not.toBeInTheDocument()
  })
})
