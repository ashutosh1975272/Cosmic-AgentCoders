// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../../src/renderer/src/components/dashboard/DashboardPage'
import { buildCardSummary, buildCardView } from '../../src/renderer/src/components/dashboard/card-view'
import { richSnapshot } from '../../src/renderer/src/demo/fixtures'
import { setDashboardApi } from '../../src/renderer/src/lib/dashboard-api'
import type { DashboardActivityMessage, DashboardProjectActivity } from '../../src/shared/dashboard-contract'

const multiplatformActivity: DashboardProjectActivity = {
  recent: [
    {
      source: 'client',
      platform: 'slack',
      channelId: 'C_SLACK',
      channelName: 'general',
      ts: '1700000100.000100',
      atIso: new Date(Date.now() - 1000 * 60).toISOString(),
      userId: 'U_SLACK',
      userName: 'Alice Slack',
      isMine: false,
      text: 'Slack message content',
      permalink: null
    },
    {
      source: 'client',
      platform: 'teams',
      channelId: 'C_TEAMS',
      channelName: 'dev',
      ts: '1700000200.000100',
      atIso: new Date(Date.now() - 1000 * 45).toISOString(),
      userId: 'U_TEAMS',
      userName: 'Bob Teams',
      isMine: false,
      text: 'Teams message content',
      permalink: null
    },
    {
      source: 'client',
      platform: 'whatsapp',
      channelId: 'wa_contact',
      channelName: 'Charlie WhatsApp',
      ts: '1700000300.000100',
      atIso: new Date(Date.now() - 1000 * 20).toISOString(),
      userId: 'U_WA',
      userName: 'Charlie WhatsApp',
      isMine: false,
      text: 'WhatsApp message content',
      permalink: null
    }
  ] as DashboardActivityMessage[],
  latestClientAt: new Date().toISOString(),
  latestOursAt: null,
  ballInCourt: null,
  participants: [],
  channels: [],
  counts14d: { client: 3, ours: 0 }
}

beforeEach(() => {
  setDashboardApi({
    getSchedules: vi.fn().mockResolvedValue({
      settings: { slackSync: { enabled: true, intervalMinutes: 15 }, dailyRecheck: { enabled: false, hour: 9 } },
      lastRunAt: { 'slack-sync': null, 'agent-analysis': null, 'daily-recheck': null },
      nextRunAt: null,
      nextDailyRunAt: null,
      running: false,
      runs: []
    }),
    onSchedulesChanged: vi.fn().mockReturnValue(() => {}),
    getProjectChatStatus: vi.fn().mockResolvedValue({
      hasKey: true,
      model: 'demo-model',
      modelSource: 'global',
      keySource: 'global'
    }),
    onConfigChanged: vi.fn().mockReturnValue(() => {}),
    getProjectActivity: vi.fn().mockResolvedValue(multiplatformActivity)
  } as any)

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  })
})

afterEach(() => {
  cleanup()
  setDashboardApi(null)
})

describe('DashboardPage — Multiplatform Feed & Filtering', () => {
  it('renders platform badges and filter pills for Slack, Teams, and WhatsApp', async () => {
    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          showDashboardSlack: true,
          showDashboardTeams: true,
          showDashboardWhatsApp: true,
          showDashboardActivityFeed: true
        }),
        onSettingsChanged: vi.fn().mockReturnValue(() => {})
      }
    } as any

    render(
      <DashboardPage
        view={buildCardView(richSnapshot, 0)}
        summary={buildCardSummary(richSnapshot, 0)}
        project={richSnapshot.project}
        snapshot={richSnapshot}
        syncing={false}
        onSync={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Latest messages · Multiplatform/i)).toBeDefined()
    })

    // Badges & filter buttons check
    expect(screen.getAllByText(/💬 Slack/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/👥 Teams/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/🟢 WhatsApp/i).length).toBeGreaterThanOrEqual(2)

    // All 3 messages visible initially
    expect(screen.getByText('Slack message content')).toBeDefined()
    expect(screen.getByText('Teams message content')).toBeDefined()
    expect(screen.getByText('WhatsApp message content')).toBeDefined()

    // Filter to WhatsApp
    const waFilterBtn = screen.getByRole('button', { name: /🟢 WhatsApp \(1\)/i })
    fireEvent.click(waFilterBtn)

    expect(screen.getByText('WhatsApp message content')).toBeDefined()
    expect(screen.queryByText('Slack message content')).toBeNull()
    expect(screen.queryByText('Teams message content')).toBeNull()
  })

  it('strictly excludes WhatsApp from feed when card dashboardRules has whatsapp: off', async () => {
    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({
          showDashboardSlack: true,
          showDashboardTeams: true,
          showDashboardWhatsApp: true
        }),
        onSettingsChanged: vi.fn().mockReturnValue(() => {})
      }
    } as any

    const projectWithWaDisabled = {
      ...richSnapshot.project,
      dashboardRules: {
        platforms: {
          whatsapp: 'off' as const
        }
      }
    }

    render(
      <DashboardPage
        view={buildCardView(richSnapshot, 0)}
        summary={buildCardSummary(richSnapshot, 0)}
        project={projectWithWaDisabled}
        snapshot={richSnapshot}
        syncing={false}
        onSync={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Latest messages · Multiplatform/i)).toBeDefined()
    })

    expect(screen.getByText('Slack message content')).toBeDefined()
    expect(screen.getByText('Teams message content')).toBeDefined()
    expect(screen.queryByText('WhatsApp message content')).toBeNull()
    expect(screen.queryByRole('button', { name: /🟢 WhatsApp/i })).toBeNull()
  })
})
