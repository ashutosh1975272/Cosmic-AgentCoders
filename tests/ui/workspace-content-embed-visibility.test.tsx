// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WorkspaceContent from '../../src/renderer/src/components/dashboard/WorkspaceContent'
import CardLiveSlackEmbed from '../../src/renderer/src/components/dashboard/CardLiveSlackEmbed'
import CosmicSidebarNav from '../../src/renderer/src/components/dashboard/CosmicSidebarNav'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import type { DashboardProject, DashboardProjectSnapshot } from '../../src/shared/dashboard-contract'
import type { Profile } from '../../src/shared/types'

import { buildCardView, buildCardSummary } from '../../src/renderer/src/components/dashboard/card-view'

describe('WorkspaceContent & Embed De-Occlusion Lifecycle', () => {
  let setEmbedVisibleMock: ReturnType<typeof vi.fn>
  let clearCardSlackEmbedMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    window.ResizeObserver = MockResizeObserver as any
    global.ResizeObserver = MockResizeObserver as any

    setEmbedVisibleMock = vi.fn().mockResolvedValue(undefined)
    clearCardSlackEmbedMock = vi.fn().mockResolvedValue(undefined)

    window.api = {
      dashboard: {
        checkCardAuth: vi.fn().mockResolvedValue(true),
        getSnapshot: vi.fn().mockResolvedValue({ projects: [], updatedAt: new Date().toISOString() }),
        discoverSourceChannels: vi.fn().mockResolvedValue({ channels: [] }),
        updateSource: vi.fn().mockResolvedValue({ ok: true }),
        onScrapeEvent: vi.fn().mockReturnValue(() => undefined),
        getSchedules: vi.fn().mockResolvedValue({ schedules: [] }),
        onSchedulesChanged: vi.fn().mockReturnValue(() => undefined),
        getProjectChatStatus: vi.fn().mockResolvedValue({ hasKey: false, model: 'test' }),
        listProjectActivity: vi.fn().mockResolvedValue([]),
        onActivityChanged: vi.fn().mockReturnValue(() => undefined),
        onConfigChanged: vi.fn().mockReturnValue(() => undefined),
        getGlobalConfig: vi.fn().mockResolvedValue({}),
        getTeamWorkspace: vi.fn().mockResolvedValue(null)
      },
      profiles: {
        activateCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        updateCardSlackEmbedBounds: vi.fn().mockResolvedValue(undefined),
        clearCardSlackEmbed: clearCardSlackEmbedMock,
        setEmbedVisible: setEmbedVisibleMock,
        startCardAppLogin: vi.fn().mockResolvedValue(undefined)
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
    displayName: 'Test User',
    avatarColor: '#6366f1',
    googleAuthStatus: 'not-signed-in',
    createdAt: new Date().toISOString(),
    apps: {
      slack: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] },
      teams: {
        sessionStatus: 'signed-in',
        availableWorkspaces: [
          { teamId: 'teams-home', teamName: 'Personal', openUrl: 'https://teams.live.com', lastSeenAt: new Date().toISOString() }
        ],
        pinnedWorkspaces: []
      },
      whatsapp: { sessionStatus: 'signed-in', availableWorkspaces: [], pinnedWorkspaces: [] }
    }
  }

  const mockProject: DashboardProject = {
    id: 'proj-1',
    name: 'Test Project',
    clientName: 'Client Alpha',
    profileId: 'prof-1',
    teamId: 'T123',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [],
    sources: [],
    createdAt: new Date().toISOString()
  }

  const mockSnapshot = {
    project: mockProject,
    sources: [],
    syncState: 'idle',
    summary: 'Mock Summary',
    newMessageCount: 0,
    totalMessageCount: 0,
    completion: 50,
    pace: 'on-track',
    mood: { state: 'calm', signal: 'steady' },
    extractedDates: {},
    effectiveDates: { startDate: null, endDate: null },
    perChannel: [],
    lastUpdatedAt: new Date().toISOString()
  } as unknown as DashboardProjectSnapshot

  const defaultProps = {
    view: buildCardView(mockSnapshot),
    summary: buildCardSummary(mockSnapshot, 0),
    project: mockProject,
    snapshot: mockSnapshot,
    channels: { teamConnected: true } as any,
    syncing: false,
    onSync: vi.fn(),
    onOpenSettings: vi.fn(),
    onSelect: vi.fn()
  }

  it('immediately dispatches setEmbedVisible(false) and clearCardSlackEmbed() when nav.openGroup is dash', () => {
    useProfileStore.setState({ profiles: [mockProfile], activeProfileId: 'prof-1' })

    render(
      <WorkspaceContent
        {...defaultProps}
        nav={{ selection: null, openGroup: 'dash' } as any}
      />
    )

    expect(setEmbedVisibleMock).toHaveBeenCalledWith(false)
    expect(clearCardSlackEmbedMock).toHaveBeenCalled()
  })

  it('dispatches setEmbedVisible(false) and clearCardSlackEmbed() when switching from teams embed to dash', () => {
    useProfileStore.setState({ profiles: [mockProfile], activeProfileId: 'prof-1' })

    const { rerender } = render(
      <WorkspaceContent
        {...defaultProps}
        nav={{ selection: 'c:teams', openGroup: 'slack' } as any}
      />
    )

    // Initially in teams embed, setEmbedVisible(true) is invoked
    expect(setEmbedVisibleMock).toHaveBeenCalledWith(true)

    setEmbedVisibleMock.mockClear()
    clearCardSlackEmbedMock.mockClear()

    // Switch to Dashboard
    rerender(
      <WorkspaceContent
        {...defaultProps}
        nav={{ selection: null, openGroup: 'dash' } as any}
      />
    )

    expect(setEmbedVisibleMock).toHaveBeenCalledWith(false)
    expect(clearCardSlackEmbedMock).toHaveBeenCalled()
  })

  it('CardLiveSlackEmbed calls both clearCardSlackEmbed and setEmbedVisible(false) on unmount', () => {
    const { unmount } = render(
      <CardLiveSlackEmbed
        projectId="proj-1"
        profileId="prof-1"
        appId="teams"
        hidden={false}
      />
    )

    clearCardSlackEmbedMock.mockClear()
    setEmbedVisibleMock.mockClear()

    unmount()

    expect(clearCardSlackEmbedMock).toHaveBeenCalledWith('card:proj-1:teams')
    expect(setEmbedVisibleMock).toHaveBeenCalledWith(false)
  })

  it('CosmicSidebarNav displays active projects when cosmicLevel1 is global', () => {
    useDashboardStore.setState({
      snapshot: {
        projects: [
          {
            project: mockProject,
            syncState: 'idle'
          } as any
        ],
        updatedAt: new Date().toISOString()
      } as any,
      cosmicLevel1: 'global',
      cosmicSelectedCardId: null
    })
    useProfileStore.setState({ profiles: [mockProfile], activeProfileId: 'prof-1' })

    const { container } = render(
      <CosmicSidebarNav
        onOpenProfilesHub={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Projects (1)')
    expect(container.textContent).toContain('Test Project')
    expect(container.textContent).not.toContain('No active project cards found.')
  })
})
