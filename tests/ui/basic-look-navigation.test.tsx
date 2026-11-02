// @vitest-environment jsdom
import { render, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BasicSidebarProjectTree } from '../../src/renderer/src/components/dashboard/BasicSidebarProjectTree'
import { ProfileSidebar } from '../../src/renderer/src/components/ProfileSidebar'
import CardLiveSlackEmbed from '../../src/renderer/src/components/dashboard/CardLiveSlackEmbed'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'

describe('BasicSidebarProjectTree & Basic Look Navigation', () => {
  afterEach(() => {
    cleanup()
  })
  const mockSnapshot = {
    teamWorkspace: null,
    projects: [
      {
        project: {
          id: 'proj-1',
          name: 'Rajesh-test-03',
          clientName: 'Client-03',
          profileId: 'prof-1',
          teamId: 'T123',
          appId: 'slack',
          tokenSource: 'oauth',
          monitors: [],
          workflowStatus: 'active'
        },
        sources: [],
        syncState: 'idle'
      },
      {
        project: {
          id: 'proj-2',
          name: 'Ashutosh-Test-01',
          clientName: 'Client-01',
          profileId: 'prof-2',
          teamId: 'T456',
          appId: 'slack',
          tokenSource: 'oauth',
          monitors: [],
          workflowStatus: 'active'
        },
        sources: [],
        syncState: 'idle'
      }
    ],
    updatedAt: new Date().toISOString()
  }

  beforeEach(() => {
    useDashboardStore.setState({
      snapshot: mockSnapshot as any,
      cosmicSelectedCardId: 'proj-1',
      basicActiveTab: 'dashboard'
    })

    window.api = {
      app: {
        getSettings: vi.fn().mockResolvedValue({}),
        onSettingsChanged: vi.fn().mockReturnValue(() => undefined)
      },
      dashboard: {
        onScrapeEvent: vi.fn().mockReturnValue(() => undefined)
      },
      profiles: {
        activateCardSlackEmbed: vi.fn().mockResolvedValue(undefined),
        updateCardSlackEmbedBounds: vi.fn().mockResolvedValue(undefined),
        clearCardSlackEmbed: vi.fn().mockResolvedValue(undefined)
      }
    } as any

    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    window.ResizeObserver = MockResizeObserver as any
    global.ResizeObserver = MockResizeObserver as any
  })

  it('renders project names as collapsible tree rows without card wrapper boxes', () => {
    const { getByText, container } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    expect(getByText('Rajesh-test-03')).not.toBeNull()
    expect(getByText('Ashutosh-Test-01')).not.toBeNull()

    // Verify selected project node does not have hardcoded card borders or card backgrounds
    const selectedNode = container.querySelector('.basic-project-node.is-selected') as HTMLElement
    expect(selectedNode).not.toBeNull()
    expect(selectedNode.style.border).toBe('')
    expect(selectedNode.style.background).toBe('')
  })

  it('renders Dashboard, Slack, Teams, WhatsApp under expanded project', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    // proj-1 is expanded by default since it matches cosmicSelectedCardId
    expect(getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(getAllByText('Slack').length).toBeGreaterThan(0)
    expect(getAllByText('Microsoft Teams').length).toBeGreaterThan(0)
    expect(getAllByText('WhatsApp').length).toBeGreaterThan(0)
  })

  it('renders extended tools (Claude, ChatGPT) when baseAppLayout is extended', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="extended" />)

    expect(getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(getAllByText('Slack').length).toBeGreaterThan(0)
    expect(getAllByText('Claude').length).toBeGreaterThan(0)
    expect(getAllByText('ChatGPT').length).toBeGreaterThan(0)
  })

  it('clicking child tab updates basicActiveTab and selects project', () => {
    const { getAllByText } = render(<BasicSidebarProjectTree baseAppLayout="standard" />)

    const slackBtn = getAllByText('Slack')[0]
    fireEvent.click(slackBtn)

    expect(useDashboardStore.getState().cosmicSelectedCardId).toBe('proj-1')
    expect(useDashboardStore.getState().basicActiveTab).toBe('slack')

    const dashBtn = getAllByText('Dashboard')[0]
    fireEvent.click(dashBtn)

    expect(useDashboardStore.getState().basicActiveTab).toBe('dashboard')
  })

  it('clicking project header toggles expand/collapse', () => {
    const { getByText } = render(
      <BasicSidebarProjectTree baseAppLayout="standard" />
    )

    // proj-2 is initially collapsed
    const proj2Header = getByText('Ashutosh-Test-01')
    fireEvent.click(proj2Header)

    // Now proj-2 is expanded
    // Let's click it again to collapse it
    fireEvent.click(proj2Header)
  })

  it('renders in ProfileSidebar when sidebarLook="basic"', () => {
    const { getByText } = render(
      <ProfileSidebar
        profiles={[]}
        activeProfileId={null}
        activeAppId={null}
        selectedTeamId={null}
        syncingProfileId={null}
        email=""
        onEmailChange={vi.fn()}
        googleBusy={false}
        statusLine=""
        unreadCounts={{}}
        recentWorkspaces={[]}
        onAddGoogle={vi.fn()}
        onCancelGoogle={vi.fn()}
        onToggleSidebar={vi.fn()}
        onSelect={vi.fn()}
        onSelectApp={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onToggleMute={vi.fn()}
        onReorder={vi.fn()}
        onOpenInSplit={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onSyncWorkspaces={vi.fn()}
        onPinFromAvailable={vi.fn()}
        onUnpin={vi.fn()}
        onDismissError={vi.fn()}
        onAddPlatform={vi.fn()}
        showLookSwitcher={true}
        sidebarLook="basic"
        showGoogleEmailInputInSidebar={true}
      />
    )

    expect(getByText('Rajesh-test-03')).not.toBeNull()
    expect(getByText('Continue with Google')).not.toBeNull()
  })

  it('renders CardLiveSlackEmbed with full-height container and canonical background', () => {
    const { container } = render(
      <CardLiveSlackEmbed appId="whatsapp" profileId="prof-1" />
    )

    const embedDiv = container.firstChild as HTMLElement
    expect(embedDiv).not.toBeNull()
    // Must not be clamped to 480px or have radius/hardcoded colors
    expect(embedDiv.style.minHeight).toBe('0px')
    expect(embedDiv.style.borderRadius).toBe('0px')
    expect(embedDiv.style.background).toBe('var(--bg-page)')
  })
})
