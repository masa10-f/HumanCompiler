/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'

const mockPush = jest.fn()
const mockSecureFetch = jest.fn()
const mockGetUser = jest.fn()
const mockGetSession = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('@/lib/api', () => ({
  secureFetch: (...args: unknown[]) => mockSecureFetch(...args),
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

jest.mock('@/components/settings/agent-tokens-card', () => ({
  AgentTokensCard: () => <section>Agent Tokens Card</section>,
}))

import SettingsPage from '../page'

const jsonResponse = (data: unknown, ok = true) =>
  ({
    ok,
    json: jest.fn().mockResolvedValue(data),
  }) as unknown as Response

const defaultSettings = {
  has_api_key: false,
  openai_model: 'gpt-6-sol',
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
  },
}

describe('SettingsPage agent tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
              'gpt-6-sol': {
                name: 'GPT-6 Sol',
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
  })

  it('shows the agent tokens card in place of the hook tokens card', async () => {
    render(<SettingsPage />)

    expect(await screen.findByText('Agent Tokens Card')).toBeInTheDocument()
    expect(screen.queryByText('Hook Tokens')).not.toBeInTheDocument()
  })
})
