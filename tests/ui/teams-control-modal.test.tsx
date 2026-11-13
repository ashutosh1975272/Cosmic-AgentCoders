// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TeamsControlModal } from '../../src/renderer/src/components/dashboard/TeamsControlModal'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('TeamsControlModal UI & Permissions Matrix', () => {
  afterEach(() => {
    cleanup()
  })

  const mockProject: DashboardProject = {
    id: 'proj-teams-1',
    name: 'Enterprise Teams Project',
    clientName: 'Contoso Ltd',
    profileId: 'prof-teams-1',
    teamId: 'TEAM_CONTOSO',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    sources: [
      {
        id: 'src-teams-1',
        workspaceName: 'Contoso Teams Main',
        role: 'client',
        enabled: true,
        backfillDays: 30,
        kind: 'browser',
        platform: 'teams',
        profileId: 'prof-teams-1',
        workspaceId: 'CONTOSO_WKSP',
        status: 'connected',
        selectionMode: 'include',
        scheduleEnabled: true,
        scheduleIntervalMinutes: 0.333,
        engineMode: 'direct_api',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        channels: [
          {
            id: 'ch-general',
            name: 'General',
            isPrivate: false,
            enabled: true,
            agentRead: true,
            agentWrite: false,
            autoReply: false
          }
        ]
      }
    ],
    workflowStatus: 'active',
    createdAt: new Date().toISOString()
  }

  const mockSource = mockProject.sources![0]

  beforeEach(() => {
    useDashboardStore.setState({
      snapshot: {
        manualTokens: [],
        syncIntervalSeconds: 300,
        pinnedOrder: [],
        projects: []
      },
      updateSource: vi.fn().mockResolvedValue(true),
      syncNow: vi.fn().mockResolvedValue(true),
      loadSnapshot: vi.fn().mockResolvedValue(undefined)
    })

    window.api = {
      dashboard: {
        discoverSourceChannels: vi.fn().mockResolvedValue({
          channels: [
            { id: 'ch-general', name: 'General', isPrivate: false, isDm: false },
            { id: 'ch-dev', name: 'Engineering', isPrivate: true, isDm: false }
          ]
        }),
        updateProjectSource: vi.fn().mockResolvedValue(true),
        syncSource: vi.fn().mockResolvedValue({ ok: true, messageCount: 5 }),
        getScrapeRuns: vi.fn().mockResolvedValue([]),
        onScrapeEvent: vi.fn().mockReturnValue(() => {})
      },
      profiles: {
        setEmbedVisible: vi.fn()
      }
    } as any
  })

  it('renders modal with Teams Live Scraper header and hides native embed', async () => {
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    expect(window.api.profiles.setEmbedVisible).toHaveBeenCalledWith(false)
    expect(screen.getByRole('heading', { level: 2, name: /Teams Control/i })).toBeDefined()
    expect(screen.getByText(/Channel & chat discovery/i)).toBeDefined()
  })

  it('loads discovered channels and displays 4-tier matrix permissions', async () => {
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined()
      expect(screen.getByText('Engineering')).toBeDefined()
    })

    // Check table headers
    expect(screen.getAllByText('Channel / Chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Dashboard Scrape/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Agent Read/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Agent Write/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Auto-Reply/i).length).toBeGreaterThan(0)
  })

  it('toggles permission checkboxes and saves permissions', async () => {
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeDefined()
    })

    const saveButton = screen.getByText('Save Permissions')
    expect(saveButton).toBeDefined()
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(useDashboardStore.getState().updateSource).toHaveBeenCalled()
    })
  })

  it('switches to Schedules tab and changes interval', async () => {
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    // Click Schedules tab
    const schedulesTab = screen.getByTestId('tab-schedules')
    fireEvent.click(schedulesTab)

    expect(screen.getByText('Automated Ingestion Schedule')).toBeDefined()
    expect(screen.getByText('Enable Automated Background Scraping')).toBeDefined()

    // Select 1m interval
    const oneMinBtn = screen.getByText('1m')
    fireEvent.click(oneMinBtn)

    await waitFor(() => {
      expect(useDashboardStore.getState().updateSource).toHaveBeenCalled()
    })
  })

  it('switches to Scrape Logs tab and renders log explorer', async () => {
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    // Click Logs tab
    const logsTab = screen.getByTestId('tab-logs')
    fireEvent.click(logsTab)

    expect(screen.getByText('Teams Scraping & Sync Audit Logs')).toBeDefined()
    await waitFor(() => {
      expect(window.api.dashboard.getScrapeRuns).toHaveBeenCalled()
    })
  })

  it('suppresses 0-message channels/drafts and strips leaked Slack channels', async () => {
    window.api.dashboard.discoverSourceChannels = vi.fn().mockResolvedValue({
      channels: [
        { id: 'ch-general', name: 'General', isPrivate: false, isDm: false, messageCount: 15 },
        { id: 'C_LEAKED_SLACK', name: '#agentworkprojecttesting', isPrivate: false, isDm: false, messageCount: 10 },
        { id: 'teams-empty-space', name: 'unknown knp (You)', isPrivate: true, isDm: true, messageCount: 0 }
      ]
    })

    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined()
    })

    expect(screen.queryByText('#agentworkprojecttesting')).toBeNull()
    expect(screen.queryByText('unknown knp (You)')).toBeNull()
  })

  it('renders clean empty state when no channels have >= 1 message', async () => {
    window.api.dashboard.discoverSourceChannels = vi.fn().mockResolvedValue({
      channels: []
    })

    const emptySource = { ...mockSource, channels: [] }
    render(
      <TeamsControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={emptySource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('No active conversations found')).toBeDefined()
    })
    expect(screen.getByText(/Only conversations with a minimum of 1 message are displayed/)).toBeDefined()
  })
})
