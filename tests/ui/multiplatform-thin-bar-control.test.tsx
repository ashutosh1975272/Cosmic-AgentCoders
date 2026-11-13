// @vitest-environment jsdom
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WorkspaceContent from '../../src/renderer/src/components/dashboard/WorkspaceContent'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardProject, DashboardProjectSnapshot } from '../../src/shared/dashboard-contract'
import type { Profile } from '../../src/shared/types'

describe('Multiplatform Thin-Bar Control & Re-authenticate Parity', () => {
  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    window.ResizeObserver = MockResizeObserver as any
    global.ResizeObserver = MockResizeObserver as any

    window.api = {
      dashboard: {
        checkCardAuth: vi.fn().mockResolvedValue(true),
        getSnapshot: vi.fn().mockResolvedValue({ projects: [], updatedAt: new Date().toISOString() }),
        discoverSourceChannels: vi.fn().mockResolvedValue({ channels: [] }),
        updateSource: vi.fn().mockResolvedValue({ ok: true })
      },
      profiles: {
        activateCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        updateCardSlackEmbedBounds: vi.fn().mockResolvedValue(undefined),
        clearCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        setEmbedVisible: vi.fn().mockResolvedValue(undefined),
        startAppLogin: vi.fn().mockResolvedValue(undefined)
      },
      app: {
        getSettings: vi.fn().mockResolvedValue({ showScrapeProgressLine: true }),
        onSettingsChanged: vi.fn().mockReturnValue(() => undefined)
      }
    } as any
  })

  afterEach(() => {
    cleanup()
  })

  const mockProfile: Profile = {
    id: 'prof-1',
    displayName: 'Ashutosh Tester',
    avatarColor: '#6366f1',
    googleAuthStatus: 'not-signed-in',
    createdAt: new Date().toISOString(),
    apps: {
      slack: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
      teams: {
        sessionStatus: 'signed-in',
        availableWorkspaces: [
          {
            teamId: 'teams-home',
            teamName: 'Personal',
            openUrl: 'https://teams.live.com',
            lastSeenAt: new Date().toISOString()
          }
        ],
        pinnedWorkspaces: []
      },
      whatsapp: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
    }
  }

  const mockProjectWithoutSources: DashboardProject = {
    id: 'proj-empty-sources',
    name: 'Fresh Project',
    clientName: 'Test Client',
    profileId: 'prof-1',
    teamId: 'TEAM_1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    sources: [],
    createdAt: new Date().toISOString()
  }

  const mockSnapshot = {
    project: mockProjectWithoutSources,
    summary: 'Mock Summary',
    newMessageCount: 0,
    totalMessageCount: 0,
    completion: 50,
    pace: 'on-track',
    mood: { state: 'calm', signal: 'steady' }
  } as unknown as DashboardProjectSnapshot

  const defaultProps = {
    view: { centre: 'card', leftSidebar: 'show', rightSidebar: 'hide', identity: 'card' } as any,
    summary: {} as any,
    project: mockProjectWithoutSources,
    snapshot: mockSnapshot,
    channels: { teamConnected: true } as any,
    syncing: false,
    onSync: vi.fn(),
    onOpenSettings: vi.fn(),
    onSelect: vi.fn()
  }

  it('renders both ⚙️ Control and Re-authenticate buttons on Teams thin bar even without pre-existing source', () => {
    useProfileStore.setState({ profiles: [mockProfile], activeProfileId: 'prof-1' })

    render(
      <WorkspaceContent
        {...defaultProps}
        nav={{ selection: 'c:teams', openGroup: 'slack' } as any}
      />
    )

    // Verify thin header bar displays Microsoft Teams and Connected
    expect(screen.getAllByText('Microsoft Teams').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Connected')).toBeDefined()

    // Verify BOTH Control and Re-authenticate exist
    const controlBtn = screen.getByRole('button', { name: /⚙️ Control/i })
    const reauthBtn = screen.getByRole('button', { name: /Re-authenticate/i })

    expect(controlBtn).toBeDefined()
    expect(reauthBtn).toBeDefined()

    // Clicking ⚙️ Control opens TeamsControlModal
    fireEvent.click(controlBtn)
    expect(screen.getByTestId('teams-control-modal')).toBeDefined()
  })

  it('renders both ⚙️ Control and Re-authenticate buttons on WhatsApp thin bar even without pre-existing source', () => {
    useProfileStore.setState({ profiles: [mockProfile], activeProfileId: 'prof-1' })

    render(
      <WorkspaceContent
        {...defaultProps}
        nav={{ selection: 'c:whatsapp', openGroup: 'slack' } as any}
      />
    )

    // Verify thin header bar displays WhatsApp and Connected
    expect(screen.getByText('WhatsApp Web')).toBeDefined()
    expect(screen.getByText('Connected')).toBeDefined()

    // Verify BOTH Control and Re-authenticate exist
    const controlBtn = screen.getByRole('button', { name: /⚙️ Control/i })
    const reauthBtn = screen.getByRole('button', { name: /Re-authenticate/i })

    expect(controlBtn).toBeDefined()
    expect(reauthBtn).toBeDefined()

    // Clicking ⚙️ Control opens WhatsAppControlModal
    fireEvent.click(controlBtn)
    expect(screen.getByTestId('whatsapp-control-modal')).toBeDefined()
  })
})
