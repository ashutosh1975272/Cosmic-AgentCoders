import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { DashboardSyncEngine } from '../../src/main/dashboard/sync-engine'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { RunLogStore } from '../../src/main/dashboard/run-log-store'
import type { DashboardProject, ProjectSource } from '../../src/shared/dashboard-contract'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

async function stores(): Promise<{
  monitors: MonitorStore
  delta: DashboardDeltaStore
  dir: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'multiplatform-sync-'))
  dirs.push(dir)
  return {
    dir,
    monitors: new MonitorStore({ rootDir: dir, encryptionAvailable: false }),
    delta: new DashboardDeltaStore({ rootDir: dir })
  }
}

describe('SyncEngine Multi-Platform Ingestion (Teams & WhatsApp without Slack)', () => {
  it('scrapes Microsoft Teams source and populates delta store and run logs', async () => {
    const { monitors, delta, dir } = await stores()
    const now = new Date().toISOString()

    const mockTeamsSource: ProjectSource = {
      id: 'src-teams-1',
      kind: 'browser',
      platform: 'teams',
      profileId: 'prof-teams',
      workspaceId: 'TEAMS_ORG_1',
      workspaceName: 'Engineering Teams',
      channelsReviewedAt: now,
      channels: [
        { id: 'ch-sprint', name: 'Sprint Standup', enabled: true, kind: 'public' }
      ],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      createdAt: now,
      updatedAt: now
    }

    const mockProject: DashboardProject = {
      id: 'proj-teams-only',
      name: 'Teams Migration Project',
      clientName: 'Contoso',
      profileId: 'prof-teams',
      teamId: 'TEAMS_ORG_1',
      appId: 'slack',
      tokenSource: 'oauth',
      monitors: [],
      sources: [mockTeamsSource],
      createdAt: now
    }

    await monitors.upsertProject({ project: mockProject })

    // Mock WebContentsView for Teams
    const mockView = {
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
          if (script.includes('team-channel-item') && script.includes('clickable.click')) {
            return true // channel selected
          }
          if (
            script.includes('indexedDB') ||
            script.includes('replychain') ||
            script.includes('message-pane-list-viewport')
          ) {
            return [
              {
                id: 'm1',
                senderName: 'Alice Dev',
                text: 'Deployment pipeline green!',
                timestamp: 1731456100000
              }
            ]
          }
          return []
        })
      }
    }

    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      getExistingCardView: (_projId, appId) => (appId === 'teams' ? mockView : null),
      getExistingBrowserView: (_profId, appId) => (appId === 'teams' ? mockView : null)
    })

    const result = await (engine as any).scrapeSource(mockProject, mockTeamsSource, { trigger: 'manual' })

    expect(result.status).toBe('success')
    expect(result.channelsRead).toBe(1)
    expect(result.newMessages).toBe(1)
    expect(result.deltas.length).toBe(1)
    expect(result.deltas[0].channelName).toBe('Sprint Standup')

    // Verify stored messages in delta store
    const storedDelta = await delta.load('prof-teams', 'TEAMS_ORG_1', 'ch-sprint')
    expect(storedDelta).not.toBeNull()
    expect(storedDelta!.messages.length).toBe(1)
    expect(storedDelta!.messages[0].user).toBe('Alice Dev')
    expect(storedDelta!.messages[0].text).toBe('Deployment pipeline green!')

    // Verify RunLogStore recorded the run
    const runLogStore = new RunLogStore({ rootDir: dir })
    const runs = await runLogStore.read('proj-teams-only')
    expect(runs.length).toBe(1)
    expect(runs[0].sourceId).toBe('src-teams-1')
    expect(runs[0].channelsRead).toBe(1)
    expect(runs[0].newMessages).toBe(1)
    expect(runs[0].engineMode).toBe('direct_api')
    expect(runs[0].channels[0].engineMode).toBe('direct_api')
  })

  it('scrapes WhatsApp Web source and populates delta store and run logs', async () => {
    const { monitors, delta, dir } = await stores()
    const now = new Date().toISOString()

    const mockWaSource: ProjectSource = {
      id: 'src-wa-1',
      kind: 'browser',
      platform: 'whatsapp',
      profileId: 'prof-wa',
      workspaceId: 'WA_OPS_1',
      workspaceName: 'Operations WhatsApp',
      channelsReviewedAt: now,
      channels: [
        { id: 'chat-emergency', name: 'Critical Escalations', enabled: true, kind: 'dm' }
      ],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      createdAt: now,
      updatedAt: now
    }

    const mockProject: DashboardProject = {
      id: 'proj-wa-only',
      name: 'WhatsApp Executive Project',
      clientName: 'Global Corp',
      profileId: 'prof-wa',
      teamId: 'WA_OPS_1',
      appId: 'slack',
      tokenSource: 'oauth',
      monitors: [],
      sources: [mockWaSource],
      createdAt: now
    }

    await monitors.upsertProject({ project: mockProject })

    // Mock WebContentsView for WhatsApp
    const mockView = {
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
          if (script.includes('openChatAt') || script.includes('node.click()')) {
            return true // chat selected
          }
          if (
            script.includes('model-storage') ||
            script.includes('indexedDB') ||
            script.includes('msg-container') ||
            script.includes('Store.Msg')
          ) {
            return [
              {
                id: 'w1',
                senderName: 'Bob Lead',
                text: 'Server scale-out complete, latency normal.',
                timestamp: 1731456200000,
                fromMe: false
              }
            ]
          }
          return []
        })
      }
    }

    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      getExistingCardView: (_projId, appId) => (appId === 'whatsapp' ? mockView : null),
      getExistingBrowserView: (_profId, appId) => (appId === 'whatsapp' ? mockView : null)
    })

    const result = await (engine as any).scrapeSource(mockProject, mockWaSource, { trigger: 'manual' })
    if (result.error) console.log('WA ERROR:', result.error)

    expect(result.status).toBe('success')
    expect(result.channelsRead).toBe(1)
    expect(result.newMessages).toBe(1)
    expect(result.deltas.length).toBe(1)
    expect(result.deltas[0].channelName).toBe('Critical Escalations')

    // Verify stored messages in delta store
    const storedDelta = await delta.load('prof-wa', 'WA_OPS_1', 'chat-emergency')
    expect(storedDelta).not.toBeNull()
    expect(storedDelta!.messages.length).toBe(1)
    expect(storedDelta!.messages[0].user).toBe('Bob Lead')
    expect(storedDelta!.messages[0].text).toBe('Server scale-out complete, latency normal.')

    // Verify RunLogStore recorded the run
    const runLogStore = new RunLogStore({ rootDir: dir })
    const runs = await runLogStore.read('proj-wa-only')
    expect(runs.length).toBe(1)
    expect(runs[0].sourceId).toBe('src-wa-1')
    expect(runs[0].engineMode).toBe('direct_api')
    expect(runs[0].channels[0].engineMode).toBe('direct_api')
  })

  it('pools persistent card view via getOrCreateCardView when existing card view is not yet cached', async () => {
    const { monitors, delta } = await stores()
    const now = new Date().toISOString()

    const mockWaSource: ProjectSource = {
      id: 'src-wa-pool',
      kind: 'browser',
      platform: 'whatsapp',
      profileId: 'prof-wa-pool',
      workspaceId: 'default',
      workspaceName: 'WhatsApp Web',
      channelsReviewedAt: now,
      channels: [
        { id: 'wa_talent_killer___', name: 'Talent Killer 👿', enabled: true, kind: 'dm' }
      ],
      role: 'client',
      enabled: true,
      backfillDays: 7,
      createdAt: now,
      updatedAt: now
    }

    const mockProject: DashboardProject = {
      id: 'proj-wa-pool',
      name: 'Ashutush',
      clientName: 'Ashutush',
      profileId: 'prof-wa-pool',
      teamId: 'default',
      appId: 'slack',
      tokenSource: 'oauth',
      monitors: [],
      sources: [mockWaSource],
      createdAt: now
    }

    await monitors.upsertProject({ project: mockProject })

    const mockCreatedView = {
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
          if (script.includes('indexedDB') || script.includes('model-storage')) {
            return [
              {
                id: 'm-tk-1',
                senderName: 'Talent Killer 👿',
                text: 'Hey are you reviewing the proposal?',
                timestamp: 1731518400000,
                fromMe: false
              }
            ]
          }
          return []
        })
      }
    }

    const getOrCreateCardViewSpy = vi.fn().mockReturnValue(mockCreatedView)

    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      oauthTokenProvider: { tryGet: async () => null },
      pollerFactory: () => ({ fetchHistory: async () => ({ messages: [], hasMore: false }) }),
      getExistingCardView: () => null,
      getOrCreateCardView: getOrCreateCardViewSpy
    })

    const result = await (engine as any).scrapeSource(mockProject, mockWaSource, { trigger: 'manual' })

    expect(getOrCreateCardViewSpy).toHaveBeenCalledWith('proj-wa-pool', 'whatsapp')
    expect(result.status).toBe('success')
    expect(result.channelsRead).toBe(1)
    expect(result.newMessages).toBe(1)

    const storedDelta = await delta.load('prof-wa-pool', 'default', 'wa_talent_killer___')
    expect(storedDelta).not.toBeNull()
    expect(storedDelta!.messages.length).toBe(1)
    expect(storedDelta!.messages[0].user).toBe('Talent Killer 👿')
    expect(storedDelta!.messages[0].text).toBe('Hey are you reviewing the proposal?')
  })

  it('throttles auto-reply bursts to dispatch only once for the latest message in a multi-message batch', async () => {
    const { monitors, delta } = await stores()
    const now = new Date().toISOString()

    const mockProject: DashboardProject = {
      id: 'proj-autoreply-throttle',
      name: 'Ashutush AutoReply',
      clientName: 'Ashutush',
      profileId: 'prof-ar-1',
      teamId: 'default',
      appId: 'teams',
      tokenSource: 'oauth',
      monitors: [],
      sources: [
        {
          id: 'src-teams-ar',
          kind: 'browser',
          platform: 'teams',
          profileId: 'prof-ar-1',
          workspaceId: 'default',
          workspaceName: 'Teams Org',
          channelsReviewedAt: now,
          channels: [
            {
              id: 'teams_chat_knp',
              name: 'unknown knp',
              enabled: true,
              kind: 'dm',
              autoReply: true,
              autoReplyPersona: 'professional'
            }
          ],
          role: 'client',
          enabled: true,
          backfillDays: 7,
          createdAt: now,
          updatedAt: now
        }
      ],
      createdAt: now
    }

    await monitors.upsertProject({ project: mockProject })

    const sentReplies: any[] = []
    const mockChatService = {
      sendMessage: vi.fn().mockImplementation(async (payload) => {
        sentReplies.push(payload)
        return { ok: true, message: { ts: '1731518500.000000', text: payload.text } }
      })
    }

    const engine = new DashboardSyncEngine({
      monitorStore: monitors,
      deltaStore: delta,
      chatService: mockChatService as any,
      oauthTokenProvider: { tryGet: async () => null }
    })

    const batch = [
      { ts: '1731518100.000001', user: 'unknown knp', text: 'hiii' },
      { ts: '1731518100.000002', user: 'unknown knp', text: 'how are you what we do in thier' },
      { ts: '1731518100.000003', user: 'unknown knp', text: 'tell me all of the points' },
      { ts: '1731518100.000004', user: 'unknown knp', text: 'are you ready ?' }
    ]

    await (engine as any).handleAutoReplyForNewMessages(
      mockProject,
      'teams_chat_knp',
      batch
    )

    // Should only dispatch 1 reply for the latest message, not 4
    expect(sentReplies.length).toBe(1)
    expect(sentReplies[0].channelId).toBe('teams_chat_knp')
    expect(sentReplies[0].text).toContain('unknown knp')
    expect(sentReplies[0].text).toContain('reviewing this and will get back to you shortly')
  })
})
