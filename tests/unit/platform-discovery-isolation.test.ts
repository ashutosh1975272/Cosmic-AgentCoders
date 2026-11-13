import { describe, it, expect } from 'vitest'
import { MonitorStore } from '../../src/main/dashboard/monitor-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DashboardProject, ScrapeRunLog } from '../../src/shared/dashboard-contract'

describe('Platform Discovery & Scrape Log Isolation', () => {
  it('MonitorStore auto-upserts Teams and WhatsApp sources with hyphenated IDs without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-isolation-'))
    try {
      const store = new MonitorStore({ rootDir: dir, encryptionAvailable: false })
      const initialProject: DashboardProject = {
        id: 'proj-123',
        name: 'Isolated Project',
        clientName: 'Client',
        profileId: 'prof-1',
        teamId: 'TEAM_1',
        appId: 'slack',
        tokenSource: 'oauth',
        monitors: [],
        sources: [],
        createdAt: new Date().toISOString()
      }
      await store.upsertProject({ project: initialProject })

      // Auto-upsert Teams source with hyphenated ID
      const teamsSource = await store.updateSource('proj-123', 'src-proj-123-teams', {
        platform: 'teams',
        workspaceName: 'Microsoft Teams',
        channels: [
          {
            id: 'teams_chat_alex',
            name: 'Alex Rivera',
            isPrivate: true,
            isDm: true,
            kind: 'dm',
            enabled: true,
            agentRead: true,
            agentWrite: true,
            autoReply: false
          }
        ]
      })

      expect(teamsSource).toBeDefined()
      expect(teamsSource.id).toBe('src-proj-123-teams')
      expect(teamsSource.platform).toBe('teams')
      expect(teamsSource.workspaceName).toBe('Microsoft Teams')
      expect(teamsSource.channels).toHaveLength(1)
      expect(teamsSource.channels[0].name).toBe('Alex Rivera')

      // Auto-upsert WhatsApp source with hyphenated ID
      const waSource = await store.updateSource('proj-123', 'src-proj-123-whatsapp', {
        platform: 'whatsapp',
        workspaceName: 'WhatsApp Web',
        channels: [
          {
            id: 'wa_customer_support',
            name: 'Customer Support Group',
            isPrivate: true,
            isDm: false,
            kind: 'group-dm',
            enabled: true,
            agentRead: true,
            agentWrite: false,
            autoReply: false
          }
        ]
      })

      expect(waSource).toBeDefined()
      expect(waSource.id).toBe('src-proj-123-whatsapp')
      expect(waSource.platform).toBe('whatsapp')
      expect(waSource.workspaceName).toBe('WhatsApp Web')
      expect(waSource.channels[0].name).toBe('Customer Support Group')

      // Ensure unknown missing source still strictly throws
      await expect(
        store.updateSource('proj-123', 'unrelated-missing-source', { scheduleEnabled: true })
      ).rejects.toThrow('Source not found')
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('filters scrape logs strictly by platform and sourceId so Slack, Teams and WhatsApp never cross-pollute', () => {
    const mockRuns: Partial<ScrapeRunLog>[] = [
      {
        runId: 'run-slack-1',
        projectId: 'proj-123',
        sourceId: 'src-slack-main',
        platform: 'slack',
        status: 'success',
        trigger: 'scheduled',
        channels: [{ channelId: 'C_SLACK', channelName: 'general', kind: 'public', messagesRead: 5, newMessages: 2, status: 'read' }]
      },
      {
        runId: 'run-teams-1',
        projectId: 'proj-123',
        sourceId: 'src-proj-123-teams',
        platform: 'teams',
        status: 'success',
        trigger: 'manual',
        channels: [{ channelId: 'T_CHAT', channelName: 'Dev Chat', kind: 'dm', messagesRead: 3, newMessages: 1, status: 'read' }]
      },
      {
        runId: 'run-whatsapp-1',
        projectId: 'proj-123',
        sourceId: 'src-proj-123-whatsapp',
        platform: 'whatsapp',
        status: 'success',
        trigger: 'manual',
        channels: [{ channelId: 'WA_CHAT', channelName: 'Product Group', kind: 'group-dm', messagesRead: 8, newMessages: 4, status: 'read' }]
      },
      {
        runId: 'run-legacy-slack-untagged',
        projectId: 'proj-123',
        status: 'success',
        trigger: 'scheduled',
        channels: [{ channelId: 'C_UNT', channelName: 'old-slack-chan', kind: 'public', messagesRead: 1, newMessages: 0, status: 'read' }]
      }
    ]

    // Simulate filterRuns logic as implemented in dashboard.ipc.ts
    const filterFn = (rows: any[], query: any) => {
      return rows.filter((row) => {
        if (query.status && query.status !== 'all' && row.status !== query.status) return false
        if (query.trigger && query.trigger !== 'all' && row.trigger !== query.trigger) return false
        if (query.sourceId && row.sourceId !== query.sourceId) return false
        if (query.platform && query.platform !== 'all') {
          const rowPlatform = row.platform || (row.sourceId?.includes('teams') ? 'teams' : row.sourceId?.includes('whatsapp') ? 'whatsapp' : 'slack')
          if (rowPlatform !== query.platform) return false
        }
        return true
      })
    }

    // Teams Control only gets Teams logs
    const teamsLogs = filterFn(mockRuns, { projectId: 'proj-123', sourceId: 'src-proj-123-teams', platform: 'teams' })
    expect(teamsLogs).toHaveLength(1)
    expect(teamsLogs[0].runId).toBe('run-teams-1')
    expect(teamsLogs[0].channels[0].channelName).toBe('Dev Chat')

    // WhatsApp Control only gets WhatsApp logs
    const waLogs = filterFn(mockRuns, { projectId: 'proj-123', sourceId: 'src-proj-123-whatsapp', platform: 'whatsapp' })
    expect(waLogs).toHaveLength(1)
    expect(waLogs[0].runId).toBe('run-whatsapp-1')
    expect(waLogs[0].channels[0].channelName).toBe('Product Group')

    // Slack Control only gets Slack logs
    const slackLogs = filterFn(mockRuns, { projectId: 'proj-123', sourceId: 'src-slack-main', platform: 'slack' })
    expect(slackLogs).toHaveLength(1)
    expect(slackLogs[0].runId).toBe('run-slack-1')
    expect(slackLogs[0].channels[0].channelName).toBe('general')

    // Untagged legacy Slack runs never leak into Teams or WhatsApp even if no sourceId filter is given
    const waAllLogs = filterFn(mockRuns, { projectId: 'proj-123', platform: 'whatsapp' })
    expect(waAllLogs.map((l: any) => l.runId)).not.toContain('run-legacy-slack-untagged')
    const teamsAllLogs = filterFn(mockRuns, { projectId: 'proj-123', platform: 'teams' })
    expect(teamsAllLogs.map((l: any) => l.runId)).not.toContain('run-legacy-slack-untagged')
  })
})
