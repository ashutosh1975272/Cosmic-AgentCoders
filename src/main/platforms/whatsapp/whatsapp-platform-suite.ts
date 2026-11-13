/**
 * whatsapp-platform-suite.ts
 *
 * Dedicated Platform Suite for WhatsApp Web.
 * Self-contained chat/contact discovery, DOM scraping, and message ingestion.
 */

import { WhatsAppReaderView } from '../../whatsapp-reader/whatsapp-reader-view'
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

export const WHATSAPP_METADATA: PlatformMetadata = {
  id: 'whatsapp',
  displayName: 'WhatsApp Web',
  shortName: 'WhatsApp',
  icon: 'whatsapp',
  defaultWorkspaceName: 'WhatsApp Web',
  supportedEngineModes: ['browser'],
  supportsGoogleSso: false,
  channelNounPlural: 'Chats & Contacts',
  channelNounSingular: 'Chat'
}

export class WhatsAppPlatformSuite implements IPlatformBackendAdapter {
  readonly metadata = WHATSAPP_METADATA

  async discoverChannels(ctx: PlatformDiscoveryContext): Promise<PlatformDiscoveryResult> {
    if (!ctx.profileId) {
      return { channels: [], error: 'Profile not found' }
    }

    const reader = new WhatsAppReaderView({
      profileId: ctx.profileId,
      existingView: ctx.existingView ?? null
    })

    try {
      if (!ctx.existingView) {
        await reader.initialize()
      }
      const discovered = await reader.listChats()
      return {
        channels: discovered.map((ch) => ({
          id: ch.id,
          name: ch.name,
          isPrivate: true,
          isDm: ch.isDm,
          kind: ch.kind,
          memberCount: ch.unreadCount
        }))
      }
    } catch (err: any) {
      return {
        channels: [],
        error: err instanceof Error ? err.message : 'WhatsApp chat discovery failed'
      }
    } finally {
      reader.dispose()
    }
  }

  async scrapeChannels(ctx: PlatformScrapeContext): Promise<PlatformScrapeResult> {
    const { project, source, targetChannels, deltaStore, runId, existingView } = ctx
    const activeEngineMode = 'browser'
    const channels: ScrapeRunChannel[] = []
    const snippets: ScrapeRunMessageSnippet[] = []
    const deltas: DashboardChannelDelta[] = []
    const peopleCounts = new Map<string, number>()
    let newMessagesCount = 0
    let channelErrors = 0

    const peopleFilter = new Set(
      (source.selectedPeople ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean)
    )

    const reader = new WhatsAppReaderView({
      profileId: source.profileId || '',
      existingView: existingView ?? null
    })

    try {
      if (!existingView) {
        await reader.initialize()
      }

      const chatsToScrape = targetChannels.filter((c) => c.enabled !== false)
      const effectiveList = chatsToScrape.length > 0 ? chatsToScrape : targetChannels

      for (const ch of effectiveList) {
        const name = ch.name || ch.id
        ctx.onScrapeEvent?.({
          type: 'step',
          runId,
          projectId: project.id,
          sourceId: source.id,
          channelName: name,
          text: `Reading WhatsApp chat ${name}…`
        })

        try {
          await reader.selectChat(ch.id)
          let messages = await reader.readMessages(ch.id)
          if (peopleFilter.size > 0) {
            messages = messages.filter((m) =>
              peopleFilter.has((m.user ?? '').trim().toLowerCase())
            )
          }

          if (messages.length === 0) {
            channels.push({
              channelId: ch.id,
              channelName: name,
              kind: ch.kind || 'dm',
              messagesRead: 0,
              newMessages: 0,
              status: 'empty',
              engineMode: activeEngineMode
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
                sender: m.user ?? 'WhatsApp Contact',
                ts: m.ts,
                snippet: m.text.slice(0, 140)
              })
            }
          }

          channels.push({
            channelId: ch.id,
            channelName: name,
            kind: ch.kind || 'dm',
            messagesRead: messages.length,
            newMessages: append.added,
            status: 'read',
            engineMode: activeEngineMode
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
            kind: ch.kind || 'dm',
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
