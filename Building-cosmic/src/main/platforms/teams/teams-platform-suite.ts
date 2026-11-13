/**
 * teams-platform-suite.ts
 *
 * Dedicated Platform Suite for Microsoft Teams.
 * Self-contained channel discovery, DOM scraping, passkey bypass, and message ingestion.
 */

import { TeamsReaderView } from '../../teams-reader/teams-reader-view'
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
import type { DashboardStoredMessage } from '../../dashboard/delta-store'

export const TEAMS_METADATA: PlatformMetadata = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  shortName: 'Teams',
  icon: 'teams',
  defaultWorkspaceName: 'Microsoft Teams',
  supportedEngineModes: ['direct_api', 'browser'],
  supportsGoogleSso: false,
  channelNounPlural: 'Teams & Chats',
  channelNounSingular: 'Chat'
}

export class TeamsPlatformSuite implements IPlatformBackendAdapter {
  readonly metadata = TEAMS_METADATA

  async discoverChannels(ctx: PlatformDiscoveryContext): Promise<PlatformDiscoveryResult> {
    if (!ctx.profileId) {
      return { channels: [], error: 'Profile not found' }
    }

    const reader = new TeamsReaderView({
      profileId: ctx.profileId,
      projectId: (ctx as any).projectId,
      existingView: ctx.existingView ?? null
    })

    try {
      if (!ctx.existingView) {
        await reader.initialize()
      }
      const discovered = await reader.listChannels()
      const activeChannels = discovered.filter(
        (ch) => ch.hasMessages !== false && (ch.messageCount === undefined || ch.messageCount >= 1)
      )
      return {
        channels: activeChannels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          isPrivate: ch.isPrivate,
          isDm: ch.isDm,
          kind: ch.kind,
          memberCount: ch.memberCount
        }))
      }
    } catch (err: any) {
      return {
        channels: [],
        error: err instanceof Error ? err.message : 'Teams channel discovery failed'
      }
    } finally {
      reader.dispose()
    }
  }

  async scrapeChannels(ctx: PlatformScrapeContext): Promise<PlatformScrapeResult> {
    const { project, source, targetChannels, deltaStore, runId, existingView } = ctx
    const requestedEngineMode = source.engineMode ?? 'direct_api'
    let activeEngineMode = requestedEngineMode
    const channels: ScrapeRunChannel[] = []
    const snippets: ScrapeRunMessageSnippet[] = []
    const deltas: DashboardChannelDelta[] = []
    const peopleCounts = new Map<string, number>()
    let newMessagesCount = 0
    let channelErrors = 0

    const peopleFilter = new Set(
      (source.selectedPeople ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean)
    )

    const reader = new TeamsReaderView({
      profileId: source.profileId || '',
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
          text: `Reading Teams channel ${name}…`
        })

        try {
          let messages: DashboardStoredMessage[] = []
          let channelEngineMode: 'direct_api' | 'browser' = requestedEngineMode

          if (requestedEngineMode === 'direct_api') {
            // Rapid Zero-DOM extraction from Teams IndexedDB (~20-50ms)
            messages = await reader.readMessages(ch.id, name)
            if (messages.length === 0) {
              // Direct store returned 0, fall back to DOM selection
              await reader.selectChannel(ch.id)
              messages = await reader.readMessages(ch.id, name)
              if (messages.length > 0) {
                channelEngineMode = 'browser'
              }
            }
          } else {
            await reader.selectChannel(ch.id)
            messages = await reader.readMessages(ch.id, name)
            channelEngineMode = 'browser'
          }

          if (peopleFilter.size > 0) {
            messages = messages.filter((m) =>
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
              engineMode: channelEngineMode
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
                sender: m.user ?? 'Teams Member',
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
            engineMode: channelEngineMode
          })

          ctx.onScrapeEvent?.({
            type: 'read',
            runId,
            projectId: project.id,
            sourceId: source.id,
            channelName: name,
            messageCount: messages.length,
            text: `Read ${messages.length} messages (${append.added} new) from ${name}`
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
      reader.dispose()
    }

    return {
      channels,
      newMessagesCount,
      peopleCounts,
      snippets,
      deltas,
      activeEngineMode,
      channelErrors
    }
  }
}
