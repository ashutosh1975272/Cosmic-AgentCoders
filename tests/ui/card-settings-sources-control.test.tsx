// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ProjectSettingsTab from '../../src/renderer/src/components/dashboard/ProjectSettingsTab'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'
import { useProfileStore } from '../../src/renderer/src/hooks/useProfiles'
import type { DashboardProject } from '../../src/shared/dashboard-contract'

describe('ProjectSettingsTab: Sources Tab Categorized Sections & Scrape Control', () => {
  const syncSourceMock = vi.fn().mockResolvedValue({
    channelsRead: 3,
    newMessages: 8,
    status: 'success'
  })
  const upsertProjectMock = vi.fn().mockResolvedValue({})

  const mockProject: DashboardProject = {
    id: 'proj-rajesh-01',
    name: 'Rajesh-Project-01',
    clientName: 'Client-test-01',
    profileId: 'prof-rajesh',
    teamId: 'T_DEFAULT',
    teamName: 'Default Team',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C_GEN', channelName: 'general' }],
    sources: [
      {
        id: 'src-card-client-1',
        kind: 'browser',
        platform: 'slack',
        profileId: 'prof-ashutosh',
        workspaceId: 'T_ASHUTOSH_1',
        workspaceName: 'Ashutosh Workspace 1',
        channels: [
          { id: 'C_PUB', name: 'public-ops', isPrivate: false, enabled: true },
          { id: 'C_PRIV', name: 'secret-leads', isPrivate: true, enabled: true }
        ],
        role: 'client',
        enabled: true,
        backfillDays: 7,
        status: 'connected',
        createdAt: '2026-11-02T10:00:00Z',
        updatedAt: '2026-11-02T10:00:00Z'
      }
    ],
    createdAt: '2026-11-02T10:00:00Z'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      dashboard: {
        getChatTokenStatus: vi.fn().mockResolvedValue({ status: 'ok' }),
        getAiSettings: vi.fn().mockResolvedValue({ enabled: false, provider: 'openai', model: 'gpt-4o' }),
        listAiModels: vi.fn().mockResolvedValue({ models: [] }),
        syncSource: syncSourceMock,
        upsertProject: upsertProjectMock,
        getRunLogs: vi.fn().mockResolvedValue([])
      }
    } as any

    useDashboardStore.setState({
      syncSource: syncSourceMock,
      upsertProject: upsertProjectMock
    })

    useProfileStore.setState({
      profiles: [
        {
          id: 'prof-ashutosh',
          displayName: 'Ashutosh-Profile',
          customName: 'Ashutosh-Profile',
          apps: {
            slack: {
              availableWorkspaces: [
                { teamId: 'T_ASHUTOSH_1', teamName: 'Ashutosh Workspace 1' },
                { teamId: 'T_ASHUTOSH_2', teamName: 'Ashutosh Workspace 2' }
              ]
            }
          },
          customLinks: [
            { id: 'link-1', name: 'Internal Wiki', url: 'https://wiki.example.com' }
          ]
        },
        {
          id: 'prof-rajesh',
          displayName: 'Rajesh-profile',
          customName: 'Rajesh-profile',
          apps: {
            slack: {
              availableWorkspaces: []
            }
          },
          customLinks: []
        }
      ] as any
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Global Accounts & Workspaces with Active state and Scrape buttons', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Verify sections exist
    expect(screen.getByText(/Global Accounts & Workspaces/i)).toBeDefined()
    expect(screen.getByText(/Attached Card Sources/i)).toBeDefined()

    // Verify Ashutosh workspaces appear under global section
    expect(screen.getAllByText(/Ashutosh Workspace 1/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Ashutosh Workspace 2/i)).toBeDefined()

    // Ashutosh Workspace 1 is already attached -> shows Active button and Scrape button
    expect(screen.getAllByText(/● Active/i).length).toBeGreaterThanOrEqual(1)

    // Ashutosh Workspace 2 is not yet attached -> shows Attach & Scrape button
    expect(screen.getByRole('button', { name: /\+ Attach & Scrape/i })).toBeDefined()
  })

  it('toggles Active / Inactive state on an attached workspace source', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Find and click the Active button for src-card-client-1
    const activeButtons = screen.getAllByRole('button', { name: /● Active/i })
    expect(activeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(activeButtons[0])

    await waitFor(() => {
      expect(upsertProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'proj-rajesh-01',
          sources: expect.arrayContaining([
            expect.objectContaining({
              id: 'src-card-client-1',
              enabled: false
            })
          ])
        })
      )
    })
  })

  it('triggers manual scrape and shows scraping status', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Click 🕷 Scrape button on Ashutosh Workspace 1
    const scrapeButtons = screen.getAllByRole('button', { name: /🕷 Scrape/i })
    expect(scrapeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(scrapeButtons[0])

    await waitFor(() => {
      expect(syncSourceMock).toHaveBeenCalledWith({
        projectId: 'proj-rajesh-01',
        sourceId: 'src-card-client-1'
      })
    })
  })

  it('attaches and scrapes an unattached global workspace directly', async () => {
    render(<ProjectSettingsTab project={mockProject} />)

    // Switch to Sources tab
    const sourcesTabBtn = screen.getByRole('tab', { name: /Sources/i })
    fireEvent.click(sourcesTabBtn)

    // Click + Attach & Scrape for Ashutosh Workspace 2
    const attachBtn = screen.getByRole('button', { name: /\+ Attach & Scrape/i })
    fireEvent.click(attachBtn)

    await waitFor(() => {
      expect(upsertProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'proj-rajesh-01',
          sources: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: 'T_ASHUTOSH_2',
              workspaceName: 'Ashutosh Workspace 2',
              profileId: 'prof-ashutosh'
            })
          ])
        })
      )
      expect(syncSourceMock).toHaveBeenCalled()
    })
  })
})
