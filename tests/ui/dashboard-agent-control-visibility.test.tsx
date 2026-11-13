// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../../src/renderer/src/components/dashboard/DashboardPage'
import { buildCardSummary, buildCardView } from '../../src/renderer/src/components/dashboard/card-view'
import { richActivity, richSnapshot } from '../../src/renderer/src/demo/fixtures'
import { setDashboardApi } from '../../src/renderer/src/lib/dashboard-api'

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
    getProjectActivity: vi.fn().mockResolvedValue(richActivity)
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

describe('DashboardPage — Agent Control & Dispatcher Visibility', () => {
  it('hides Agent Control & Slack Dispatcher by default when showDashboardAgentControl is false or undefined', async () => {
    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ showDashboardAgentControl: false }),
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
      expect(screen.queryByText(/Agent Control & Slack Dispatcher/i)).toBeNull()
    })
  })

  it('renders Agent Control & Slack Dispatcher when showDashboardAgentControl is true', async () => {
    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ showDashboardAgentControl: true }),
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
      expect(screen.getByText(/Agent Control & Slack Dispatcher/i)).toBeDefined()
    })
  })

  it('reactively updates visibility when onSettingsChanged triggers', async () => {
    let settingsCallback: any = null
    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ showDashboardAgentControl: false }),
        onSettingsChanged: vi.fn().mockImplementation((cb) => {
          settingsCallback = cb
          return () => {}
        })
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
      expect(screen.queryByText(/Agent Control & Slack Dispatcher/i)).toBeNull()
    })

    // Simulate settings changed to ON
    if (typeof settingsCallback === 'function') {
      settingsCallback({ showDashboardAgentControl: true })
    }

    await waitFor(() => {
      expect(screen.getByText(/Agent Control & Slack Dispatcher/i)).toBeDefined()
    })

    // Simulate settings changed back to OFF
    if (typeof settingsCallback === 'function') {
      settingsCallback({ showDashboardAgentControl: false })
    }

    await waitFor(() => {
      expect(screen.queryByText(/Agent Control & Slack Dispatcher/i)).toBeNull()
    })
  })
})
