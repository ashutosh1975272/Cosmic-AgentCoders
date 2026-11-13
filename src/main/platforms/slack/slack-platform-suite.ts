/**
 * slack-platform-suite.ts
 *
 * Dedicated Platform Suite for Slack Workspaces.
 * Encapsulates Direct API discovery/scraping and Browser DOM fallback.
 */

import { SlackApiClient } from '../../dashboard/slack-api-client'
import { sessionTokenExtractor } from '../../slack-reader/session-token-extractor'
import { SlackReaderView } from '../../slack-reader/slack-reader-view'
import type {
  IPlatformBackendAdapter,
  PlatformMetadata,
  PlatformDiscoveryContext,
  PlatformDiscoveryResult,
  PlatformScrapeContext,
  PlatformScrapeResult
} from '../../../shared/platforms/platform-contract'
import type {
  ScrapeRunChannel,
  ScrapeRunMessageSnippet,
  DashboardChannelDelta
} from '../../../shared/dashboard-contract'
import { log } from '../../logging'

export const SLACK_METADATA: PlatformMetadata = {
  id: 'slack',
  displayName: 'Slack Workspace',
  shortName: 'Slack',
  icon: 'slack',
  defaultWorkspaceName: 'Slack Workspace',
  supportedEngineModes: ['direct_api', 'browser'],
  supportsGoogleSso: true,
  channelNounPlural: 'Channels & DMs',
  channelNounSingular: 'Channel'
}

export class SlackPlatformSuite implements IPlatformBackendAdapter {
  readonly metadata = SLACK_METADATA

  async discoverChannels(ctx: PlatformDiscoveryContext): Promise<PlatformDiscoveryResult> {
    const { projectId, profileId, workspaceId, existingView } = ctx
    if (!profileId) {
      return { channels: [], error: 'Profile not found — log in to Slack first' }
    }
    if (!workspaceId) {
      return { channels: [], error: 'Workspace not found' }
    }

    // 1. Direct API discovery: Fast, Zero-DOM, queries conversations.list directly
    const candidatePartitions = [
      projectId ? `persist:card-${projectId}-slack` : undefined,
      `persist:profile-${profileId}-slack`,
      `persist:partition-${profileId}`
    ].filter(Boolean) as string[]

    const existingViews = existingView ? [existingView] : []
    const cacheKey = `slack:session:${profileId}:${workspaceId}`

    try {
      const creds = await sessionTokenExtractor.extractSlackSessionTokens(
        existingViews,
        cacheKey,
        { partitions: candidatePartitions }
      )
      if (creds) {
        const client = new SlackApiClient(creds)
        void client.loadWorkspaceUsers().catch(() => {})
        const discovered = await client.listWorkspaceChannels()
        if (discovered.length > 0) {
          return {
            channels: discovered.map((ch) => ({
              id: ch.id,
              name: ch.name,
              isPrivate: ch.isPrivate,
              isDm: ch.isDm,
              kind: ch.kind,
              memberCount: ch.memberCount
            }))
          }
        }
      }
    } catch (err: any) {
      log.info('[SlackPlatformSuite] direct API channel discovery fallback to DOM:', {
        error: err?.message
      })
    }

    // 2. Fallback to browser DOM reader if direct API was unable to discover channels
    const reader = new SlackReaderView({
      profileId,
      workspaceId,
      projectId,
      existingView
    })

    try {
      if (!existingView) {
        await reader.initialize()
        const bgView = reader.getView()
        if (
          bgView &&
          !bgView.webContents.isDestroyed() &&
          !bgView.webContents.getURL().includes('slack.com')
        ) {
          const targetUrl = `https://app.slack.com/client/${workspaceId}`
          try {
            await bgView.webContents.loadURL(targetUrl)
            await reader.waitForContent(8000)
          } catch {
            // ignore
          }
        }
      }
      const discovered = await reader.listChannels()
      if (discovered.length === 0) {
        return {
          channels: [],
          error: 'No channels visible. Log in to Slack in this card, then retry discovery.'
        }
      }
      return {
        channels: discovered.map((channel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.isPrivate,
          isDm: Boolean(channel.isDm),
          kind: channel.isDm
            ? 'dm'
            : channel.isPrivate
              ? 'private'
              : 'public',
          created: channel.created,
          memberCount: channel.memberCount
        }))
      }
    } catch (err) {
      return {
        channels: [],
        error: err instanceof Error ? err.message : 'Channel discovery failed'
      }
    } finally {
      reader.destroy()
    }
  }

  async scrapeChannels(ctx: PlatformScrapeContext): Promise<PlatformScrapeResult> {
    const { project, source, targetChannels, deltaStore, runId, existingView } = ctx
    const activeEngineMode = source.engineMode ?? 'direct_api'
    const channels: ScrapeRunChannel[] = []
    const snippets: ScrapeRunMessageSnippet[] = []
    const deltas: DashboardChannelDelta[] = []
    const peopleCounts = new Map<string, number>()
    let newMessagesCount = 0
    let channelErrors = 0

    const peopleFilter = new Set(
      (source.selectedPeople ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean)
    )

    // Direct API scraping with session tokens
    const candidatePartitions = [
      `persist:card-${project.id}-slack`,
      `persist:profile-${source.profileId}-slack`,
      `persist:partition-${source.profileId}`
    ]

    const existingViews = existingView ? [existingView] : []
    const cacheKey = `slack:session:${source.profileId}:${source.workspaceId}`
    let creds: any = null

    try {
      creds = await sessionTokenExtractor.extractSlackSessionTokens(
        existingViews,
        cacheKey,
        { partitions: candidatePartitions }
      )
    } catch {
      // fallback to DOM
    }

    if (creds && activeEngineMode !== 'browser') {
      const client = new SlackApiClient(creds)
      void client.loadWorkspaceUsers().catch(() => {})

      const channelsToScrape = targetChannels.filter((c) => c.enabled !== false)
      const effectiveList = channelsToScrape.length > 0 ? channelsToScrape : targetChannels

      for (const ch of effectiveList) {
        const name = ch.name || ch.id
        ctx.onScrapeEvent?.({
          type: 'step',
          runId,
          projectId: project.id,
          sourceId: source.id,
          channelName: name,
          text: `Reading Slack channel #${name}…`
        })

        try {
          const apiResult = await client.fetchChannelMessages({ channelId: ch.id, maxMessages: 30 })
          let messages = apiResult.messages

          if (peopleFilter.size > 0) {
            messages = messages.filter((m: any) =>
              peopleFilter.has((m.user ?? '').trim().toLowerCase())
            )
          }

          if (messages.length === 0) {
            channels.push({
              channelId: ch.id,
              channelName: name,
              kind: ch.kind || 'public',
              messagesRead: 0,
              newMessages: 0,
              status: 'empty',
              engineMode: 'direct_api'
            })
            continue
          }

          const append = await deltaStore.appendMessages({
            profileId: source.profileId,
            teamId: source.workspaceId,
            channelId: ch.id,
            channelName: name,
            messages,
            source: source.role ?? 'client'
          })

          newMessagesCount += append.added
          const latestTs = messages[messages.length - 1]?.ts
          deltas.push({
            channelId: ch.id,
            channelName: name,
            source: source.role ?? 'client',
            messageCount: messages.length,
            newMessageCount: append.added,
            latestMessageAt: latestTs
              ? new Date(Number(latestTs) * 1000).toISOString()
              : new Date().toISOString(),
            lastSyncAt: append.lastSyncAt,
            cursor: append.cursor
          })

          for (const m of messages) {
            if (m.user) {
              peopleCounts.set(m.user, (peopleCounts.get(m.user) ?? 0) + 1)
            }
            if (snippets.length < 20 && m.text) {
              snippets.push({
                channelId: ch.id,
                channelName: name,
                sender: m.user ?? 'Slack User',
                ts: m.ts,
                snippet: m.text.slice(0, 140)
              })
            }
          }

          channels.push({
            channelId: ch.id,
            channelName: name,
            kind: ch.kind || 'public',
            messagesRead: messages.length,
            newMessages: append.added,
            status: 'read',
            engineMode: 'direct_api'
          })

          ctx.onScrapeEvent?.({
            type: 'read',
            runId,
            projectId: project.id,
            sourceId: source.id,
            channelName: name,
            messageCount: messages.length,
            text: `Read ${messages.length} messages (${append.added} new) from #${name}`
          })
        } catch (chErr: any) {
          channelErrors++
          channels.push({
            channelId: ch.id,
            channelName: name,
            kind: ch.kind || 'public',
            messagesRead: 0,
            newMessages: 0,
            status: 'error',
            error: chErr instanceof Error ? chErr.message : String(chErr)
          })
        }
      }

      return {
        channels,
        newMessagesCount,
        peopleCounts,
        snippets,
        deltas,
        activeEngineMode: 'direct_api',
        channelErrors
      }
    }

    // Browser DOM fallback
    const reader = new SlackReaderView({
      profileId: source.profileId || '',
      workspaceId: source.workspaceId,
      projectId: project.id,
      existingView: existingView ?? null
    })

    try {
      if (!existingView) {
        await reader.initialize()
      }

      const channelsToScrape = targetChannels.filter((c) => c.enabled !== false)
      const effectiveList = channelsToScrape.length > 0 ? channelsToScrape : targetChannels

      for (const ch of effectiveList) {
        const name = ch.name || ch.id
        ctx.onScrapeEvent?.({
          type: 'step',
          runId,
          projectId: project.id,
          sourceId: source.id,
          channelName: name,
          text: `Reading Slack channel #${name} via Browser DOM…`
        })

        try {
          const domResult = await reader.readChannelWindow(ch.id, { maxMessages: 30, signal: ctx.signal })
          let messages = domResult.messages
          if (peopleFilter.size > 0) {
            messages = messages.filter((m: any) =>
              peopleFilter.has((m.user ?? '').trim().toLowerCase())
            )
          }

          if (messages.length === 0) {
            channels.push({
              channelId: ch.id,
              channelName: name,
              kind: ch.kind || 'public',
              messagesRead: 0,
              newMessages: 0,
              status: 'empty',
              engineMode: 'browser'
            })
            continue
          }

          const append = await deltaStore.appendMessages({
            profileId: source.profileId,
            teamId: source.workspaceId,
            channelId: ch.id,
            channelName: name,
            messages,
            source: source.role ?? 'client'
          })

          newMessagesCount += append.added
          const latestTs = messages[messages.length - 1]?.ts
          deltas.push({
            channelId: ch.id,
            channelName: name,
            source: source.role ?? 'client',
            messageCount: messages.length,
            newMessageCount: append.added,
            latestMessageAt: latestTs
              ? new Date(Number(latestTs) * 1000).toISOString()
              : new Date().toISOString(),
            lastSyncAt: append.lastSyncAt,
            cursor: append.cursor
          })

          for (const m of messages) {
            if (m.user) {
              peopleCounts.set(m.user, (peopleCounts.get(m.user) ?? 0) + 1)
            }
            if (snippets.length < 20 && m.text) {
              snippets.push({
                channelId: ch.id,
                channelName: name,
                sender: m.user ?? 'Slack User',
                ts: m.ts,
                snippet: m.text.slice(0, 140)
              })
            }
          }

          channels.push({
            channelId: ch.id,
            channelName: name,
            kind: ch.kind || 'public',
            messagesRead: messages.length,
            newMessages: append.added,
            status: 'read',
            engineMode: 'browser'
          })
        } catch (chErr: any) {
          channelErrors++
          channels.push({
            channelId: ch.id,
            channelName: name,
            kind: ch.kind || 'public',
            messagesRead: 0,
            newMessages: 0,
            status: 'error',
            error: chErr instanceof Error ? chErr.message : String(chErr)
          })
        }
      }
    } finally {
      reader.destroy()
    }

    return {
      channels,
      newMessagesCount,
      peopleCounts,
      snippets,
      deltas,
      activeEngineMode: 'browser',
      channelErrors
    }
  }
}
