// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WhatsAppControlModal } from '../../src/renderer/src/components/dashboard/WhatsAppControlModal'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('WhatsAppControlModal UI & Permissions Matrix', () => {
  afterEach(() => {
    cleanup()
  })

  const mockProject: DashboardProject = {
    id: 'proj-wa-1',
    name: 'Executive WhatsApp Project',
    clientName: 'Global Client',
    profileId: 'prof-wa-1',
    teamId: 'WA_GLOBAL',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    sources: [
      {
        id: 'src-wa-1',
        workspaceName: 'Operations WhatsApp Chat',
        role: 'client',
        enabled: true,
        backfillDays: 30,
        kind: 'browser',
        platform: 'whatsapp',
        profileId: 'prof-wa-1',
        workspaceId: 'WA_GLOBAL_WKSP',
        status: 'connected',
        selectionMode: 'include',
        scheduleEnabled: true,
        scheduleIntervalMinutes: 0.333,
        engineMode: 'direct_api',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        channels: [
          {
            id: 'chat-client-ops',
            name: 'Client Operations & Deployments',
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
            { id: 'chat-client-ops', name: 'Client Operations & Deployments', isPrivate: false, isDm: true },
            { id: 'chat-dev-triage', name: 'Emergency Triage', isPrivate: true, isDm: false }
          ]
        }),
        updateProjectSource: vi.fn().mockResolvedValue(true),
        syncSource: vi.fn().mockResolvedValue({ ok: true, messageCount: 8 }),
        getScrapeRuns: vi.fn().mockResolvedValue([]),
        onScrapeEvent: vi.fn().mockReturnValue(() => {})
      },
      profiles: {
        setEmbedVisible: vi.fn()
      }
    } as any
  })

  it('renders modal with WhatsApp Rapid Reader header and hides native embed', async () => {
    render(
      <WhatsAppControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    expect(window.api.profiles.setEmbedVisible).toHaveBeenCalledWith(false)
    expect(screen.getByRole('heading', { level: 2, name: /WhatsApp Control/i })).toBeDefined()
    expect(screen.getByText(/Chat & contact discovery/i)).toBeDefined()
  })

  it('loads discovered chats and displays 4-tier matrix permissions', async () => {
    render(
      <WhatsAppControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Client Operations & Deployments')).toBeDefined()
      expect(screen.getByText('Emergency Triage')).toBeDefined()
    })

    // Check table headers
    expect(screen.getAllByText('Chat / Contact').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Dashboard Scrape/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Agent Read/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Agent Write/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Auto-Reply/i).length).toBeGreaterThan(0)
  })

  it('toggles chat permission checkboxes and saves permissions', async () => {
    render(
      <WhatsAppControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Emergency Triage')).toBeDefined()
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
      <WhatsAppControlModal
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
      <WhatsAppControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    // Click Logs tab
    const logsTab = screen.getByTestId('tab-logs')
    fireEvent.click(logsTab)

    expect(screen.getByText('WhatsApp Scraping & Sync Audit Logs')).toBeDefined()
    await waitFor(() => {
      expect(window.api.dashboard.getScrapeRuns).toHaveBeenCalled()
    })
  })

  it('suppresses 0-message chats and strips leaked Slack channels', async () => {
    window.api.dashboard.discoverSourceChannels = vi.fn().mockResolvedValue({
      channels: [
        { id: 'chat-client-ops', name: 'Client Operations & Deployments', isPrivate: false, isDm: true, messageCount: 5 },
        { id: 'C_LEAKED_SLACK', name: '#agentworkprojecttesting', isPrivate: false, isDm: false, messageCount: 10 },
        { id: 'wa-empty-chat', name: 'Empty Contact', isPrivate: true, isDm: true, messageCount: 0 }
      ]
    })

    render(
      <WhatsAppControlModal
        open={true}
        onClose={vi.fn()}
        project={mockProject}
        source={mockSource}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Client Operations & Deployments')).toBeDefined()
    })

    expect(screen.queryByText('#agentworkprojecttesting')).toBeNull()
    expect(screen.queryByText('Empty Contact')).toBeNull()
  })

  it('renders clean empty state when no chats have >= 1 message', async () => {
    window.api.dashboard.discoverSourceChannels = vi.fn().mockResolvedValue({
      channels: []
    })

    const emptySource = { ...mockSource, channels: [] }
    render(
      <WhatsAppControlModal
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
