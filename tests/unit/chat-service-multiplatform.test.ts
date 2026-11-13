import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { DashboardChatService } from '../../src/main/dashboard/chat-service'
import type { DashboardProject } from '../../src/shared/dashboard-contract'
import type { AppSettings } from '../../src/shared/ipc-contract'

const fakeVault = {
  encrypt: (p: string) => Buffer.from(p).toString('base64'),
  decrypt: (b: string) => Buffer.from(b, 'base64').toString('utf8')
}

const dirs: string[] = []

describe('DashboardChatService — Multiplatform & Inheritance', () => {
  let dir: string
  let monitorStore: MonitorStore
  let deltaStore: DashboardDeltaStore
  let project: DashboardProject
  let appSettings: AppSettings

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'multiplatform-chat-'))
    dirs.push(dir)
    monitorStore = new MonitorStore({ rootDir: dir, encryptionAvailable: true, vault: fakeVault })
    deltaStore = new DashboardDeltaStore({ rootDir: join(dir, 'dashboard') })

    appSettings = {
      showDashboardSlack: true,
      showDashboardTeams: true,
      showDashboardWhatsApp: true,
      showDashboardAgentControl: false,
      showDashboardActivityFeed: true,
      showDashboardAttention: true,
      showDashboardDecisionVault: true
    } as AppSettings

    project = await monitorStore.upsertProject({
      project: {
        id: '',
        name: 'Multiplatform Project',
        clientName: 'Client Co',
        profileId: 'pf1',
        teamId: 'T1',
        appId: 'slack',
        tokenSource: 'manual',
        monitors: [],
        sources: [
          {
            id: 'src-slack',
            kind: 'browser',
            platform: 'slack',
            profileId: 'pf1',
            workspaceId: 'ws-slack',
            workspaceName: 'Slack Workspace',
            role: 'client',
            enabled: true,
            backfillDays: 30,
            channels: [{ id: 'C_SLACK', name: 'general', enabled: true }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: 'src-teams',
            kind: 'browser',
            platform: 'teams',
            profileId: 'pf2',
            workspaceId: 'ws-teams',
            workspaceName: 'Teams Org',
            role: 'client',
            enabled: true,
            backfillDays: 30,
            channels: [{ id: 'C_TEAMS', name: 'engineering', enabled: true }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: 'src-wa',
            kind: 'browser',
            platform: 'whatsapp',
            profileId: 'pf3',
            workspaceId: 'ws-wa',
            workspaceName: 'WhatsApp Web',
            role: 'client',
            enabled: true,
            backfillDays: 30,
            channels: [{ id: 'wa_contact', name: 'John WhatsApp', enabled: true }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      }
    })

    const nowSec = Math.floor(Date.now() / 1000)

    // Append Slack message
    await deltaStore.appendMessages({
      profileId: 'pf1',
      teamId: 'ws-slack',
      channelId: 'C_SLACK',
      channelName: 'general',
      messages: [{ ts: `${nowSec - 100}.000100`, user: 'U_SLACK', text: 'Hello from Slack' }]
    })

    // Append Teams message
    await deltaStore.appendMessages({
      profileId: 'pf2',
      teamId: 'ws-teams',
      channelId: 'C_TEAMS',
      channelName: 'engineering',
      messages: [{ ts: `${nowSec - 80}.000100`, user: 'Alice Teams', text: 'Update from Teams' }]
    })

    // Append WhatsApp message
    await deltaStore.appendMessages({
      profileId: 'pf3',
      teamId: 'ws-wa',
      channelId: 'wa_contact',
      channelName: 'John WhatsApp',
      messages: [{ ts: `${nowSec - 50}.000100`, user: 'John WhatsApp', text: 'Ping from WhatsApp' }]
    })
  })

  afterEach(async () => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) await rm(d, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('aggregates messages from Slack, Teams, and WhatsApp sources with correct platform tags', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings
    })

    const activity = await service.projectActivity(project.id)
    expect(activity.recent.length).toBe(3)

    const platforms = activity.recent.map((m) => m.platform)
    expect(platforms).toContain('slack')
    expect(platforms).toContain('teams')
    expect(platforms).toContain('whatsapp')

    const waMsg = activity.recent.find((m) => m.platform === 'whatsapp')
    expect(waMsg?.text).toBe('Ping from WhatsApp')
    expect(waMsg?.channelName).toBe('John WhatsApp')

    const teamsMsg = activity.recent.find((m) => m.platform === 'teams')
    expect(teamsMsg?.text).toBe('Update from Teams')
  })

  it('strictly excludes WhatsApp messages when card dashboardRules sets whatsapp: off', async () => {
    await monitorStore.upsertProject({
      project: {
        ...project,
        dashboardRules: {
          platforms: {
            whatsapp: 'off'
          }
        }
      }
    })

    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings
    })

    const activity = await service.projectActivity(project.id)
    const platforms = activity.recent.map((m) => m.platform)
    expect(platforms).toContain('slack')
    expect(platforms).toContain('teams')
    expect(platforms).not.toContain('whatsapp')
  })

  it('excludes Teams when global showDashboardTeams is false and card is set to inherit', async () => {
    appSettings.showDashboardTeams = false

    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings
    })

    const activity = await service.projectActivity(project.id)
    const platforms = activity.recent.map((m) => m.platform)
    expect(platforms).toContain('slack')
    expect(platforms).toContain('whatsapp')
    expect(platforms).not.toContain('teams')
  })

  it('loads WhatsApp messages from source workspace directory when querying WhatsApp channel', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings
    })

    const page = await service.loadMessages({
      projectId: project.id,
      channelId: 'wa_contact'
    })

    expect(page.messages.length).toBe(1)
    expect(page.messages[0].text).toBe('Ping from WhatsApp')
    expect(page.messages[0].channelName).toBe('John WhatsApp')
  })

  it('routes sendMessage to WhatsApp and records sent message in delta store', async () => {
    const mockView = {
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => {
          if (script.includes('compose-btn-send') || script.includes('insertText')) {
            return true
          }
          if (script.includes('Store.Cmd.openChatAt') || script.includes('pane-side')) {
            return true
          }
          return false
        }
      }
    } as any

    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings,
      getExistingBrowserView: () => mockView
    })

    const result = await service.sendMessage({
      projectId: project.id,
      channelId: 'wa_contact',
      text: 'Hello from Cosmic!'
    })

    expect(result.ok).toBe(true)
    expect(result.message?.text).toBe('Hello from Cosmic!')

    // Verify it was appended to delta store
    const stored = await deltaStore.load('pf3', 'ws-wa', 'wa_contact')
    expect(stored?.messages.some((m) => m.text === 'Hello from Cosmic!')).toBe(true)
  })

  it('routes sendMessage to WhatsApp using getExistingCardView with card partition', async () => {
    let queriedProjectId = ''
    let queriedAppId = ''
    const mockView = {
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: async (script: string) => {
          if (script.includes('compose-btn-send') || script.includes('insertText')) {
            return true
          }
          if (script.includes('Store.Cmd.openChatAt') || script.includes('pane-side')) {
            return true
          }
          return false
        }
      }
    } as any

    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings,
      getExistingCardView: (projId, appId) => {
        queriedProjectId = projId
        queriedAppId = appId
        return mockView
      }
    })

    const result = await service.sendMessage({
      projectId: project.id,
      channelId: 'wa_contact',
      text: 'Direct dispatch to WhatsApp via card session'
    })

    expect(result.ok).toBe(true)
    expect(queriedProjectId).toBe(project.id)
    expect(queriedAppId).toBe('whatsapp')
    expect(result.message?.text).toBe('Direct dispatch to WhatsApp via card session')
  })

  it('enforces dynamic platform text limit error on WhatsApp', async () => {
    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings
    })

    const res = await service.sendMessage({
      projectId: project.id,
      channelId: 'wa_contact',
      text: 'a'.repeat(4001)
    })

    expect(res.ok).toBe(false)
    expect(res.error).toBe('WhatsApp messages are limited to 4000 characters.')
  })

  it('wires auto-reply on WhatsApp messages when autoReply is enabled and ignores our own messages', async () => {
    const freshProject = await monitorStore.upsertProject({
      project: {
        ...project,
        sources: project.sources?.map((s) =>
          s.id === 'src-wa'
            ? {
                ...s,
                channels: [
                  {
                    id: 'wa_contact',
                    name: 'John WhatsApp',
                    enabled: true,
                    isDm: true,
                    autoReply: true,
                    autoReplyPersona: 'professional'
                  }
                ]
              }
            : s
        )
      }
    })

    let sentPayload: any = null
    const mockService = {
      sendMessage: async (p: any) => {
        sentPayload = p
        return { ok: true, message: { text: p.text, source: 'client' } }
      }
    }

    const { DashboardInsightSyncEngine } = await import('../../src/main/dashboard/sync-engine')
    const engine = new DashboardInsightSyncEngine({
      monitorStore,
      deltaStore,
      chatService: mockService as any,
      oauthTokenProvider: { tryGet: async () => null }
    })

    // 1. Message from client triggers auto-reply
    await (engine as any).handleAutoReplyForNewMessages(freshProject, 'wa_contact', [
      {
        ts: '1730000000.000001',
        user: 'John WhatsApp',
        text: 'Hello, need an update please',
        source: 'client'
      }
    ])

    expect(sentPayload).not.toBeNull()
    expect(sentPayload.projectId).toBe(project.id)
    expect(sentPayload.channelId).toBe('wa_contact')
    expect(sentPayload.text).toContain('Thanks for reaching out')
    expect(sentPayload.isAgent).toBe(true)

    // 2. Message from "You" / "ours" does NOT trigger auto-reply
    sentPayload = null
    await (engine as any).handleAutoReplyForNewMessages(freshProject, 'wa_contact', [
      {
        ts: '1730000000.000002',
        user: 'You',
        text: 'This is my own message',
        source: 'ours'
      }
    ])

    expect(sentPayload).toBeNull()
  })

  it('dispatches outbound message to WhatsApp contact and records it in deltaStore', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('header')) return 'John WhatsApp'
        if (script.includes('compose-btn-send') || script.includes('insertText')) return true
        return true
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const service = new DashboardChatService({
      monitorStore,
      deltaStore,
      oauthTokenProvider: { tryGet: async () => null },
      getAppSettings: async () => appSettings,
      getExistingCardView: () => mockView
    })

    const res = await service.sendMessage({
      projectId: project.id,
      channelId: 'wa_contact',
      text: 'Hello Talent Killer, here is the automated response.'
    })

    expect(res.ok).toBe(true)
    expect(res.message).toBeDefined()
    expect(res.message.text).toBe('Hello Talent Killer, here is the automated response.')

    // Verify written to deltaStore
    const delta = await deltaStore.load('pf3', 'ws-wa', 'wa_contact')
    expect(delta).not.toBeNull()
    const lastMsg = delta!.messages[delta!.messages.length - 1]
    expect(lastMsg.text).toBe('Hello Talent Killer, here is the automated response.')
    expect(lastMsg.user).toBe('You')
  })
})
