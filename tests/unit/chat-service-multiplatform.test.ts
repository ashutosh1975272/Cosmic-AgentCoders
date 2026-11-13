import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('card rule of "on" overrides global setting of false', async () => {
    appSettings.showDashboardWhatsApp = false

    await monitorStore.upsertProject({
      project: {
        ...project,
        dashboardRules: {
          platforms: {
            whatsapp: 'on' // explicitly force ON
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
    expect(platforms).toContain('whatsapp')
  })
})
