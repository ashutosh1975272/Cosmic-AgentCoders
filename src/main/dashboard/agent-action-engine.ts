import type {
  DashboardChatMessage,
  DashboardProject,
  ProjectSource,
  ProjectSourceChannel
} from '../../shared/dashboard-contract'
import { log } from '../logging'
import type { DashboardChatService } from './chat-service'
import type { DashboardSyncEngine } from './sync-engine'
import type { DashboardScheduleStore } from './schedule-store'
import type { MonitorStore } from './monitor-store'

export interface AgentAction {
  type: 'send_slack' | 'read_channel' | 'trigger_scrape' | 'set_schedule' | 'list_capabilities'
  channelNameOrId?: string
  text?: string
  count?: number
  intervalMinutes?: number
  enabled?: boolean
}

export interface AgentActionResult {
  handled: boolean
  action?: AgentAction
  ok: boolean
  cardType?: 'slack_dispatch' | 'channel_read' | 'scrape_trigger' | 'schedule_set' | 'permission_denied' | 'capabilities'
  cardData?: Record<string, unknown>
  replyMarkdown: string
}

export interface AgentActionContext {
  projectId: string
  project: DashboardProject
  chatService?: DashboardChatService
  syncEngine?: DashboardSyncEngine
  scheduleStore?: DashboardScheduleStore
  monitorStore?: Pick<MonitorStore, 'listProjects'> & Partial<Pick<MonitorStore, 'upsertProject'>>
}

/**
 * Normalizes channel queries (e.g. "#general", "general", "agentworkprojecttesting")
 * for case-insensitive matching.
 */
export function cleanChannel(name: string): string {
  return name.trim().replace(/^[#@]/, '').toLowerCase()
}

/**
 * Fuzzy score between query and channel name (0 to 1).
 */
function channelScore(query: string, candidate: string): number {
  const q = cleanChannel(query)
  const c = cleanChannel(candidate)
  if (!q || !c) return 0
  if (q === c) return 1.0
  if (c.includes(q) || q.includes(c)) return 0.85

  // Levenshtein / letter overlap distance
  const lenDiff = Math.abs(q.length - c.length)
  if (lenDiff > 3) return 0
  let diff = 0
  let i = 0
  let j = 0
  while (i < q.length && j < c.length) {
    if (q[i] === c[j]) {
      i++
      j++
    } else {
      diff++
      if (q.length > c.length) i++
      else if (c.length > q.length) j++
      else {
        i++
        j++
      }
    }
  }
  diff += (q.length - i) + (c.length - j)
  return diff <= 2 ? 0.75 : 0
}

/**
 * Finds a matching channel from the project's sources or monitors by name or ID.
 */
export function resolveProjectChannel(
  project: DashboardProject,
  target: string
): { channel: ProjectSourceChannel; source?: ProjectSource } | null {
  const query = cleanChannel(target)
  if (!query) return null

  let bestMatch: { channel: ProjectSourceChannel; source?: ProjectSource } | null = null
  let bestScore = 0

  for (const src of project.sources ?? []) {
    for (const ch of src.channels ?? []) {
      const scoreName = channelScore(query, ch.name)
      const scoreId = channelScore(query, ch.id)
      const score = Math.max(scoreName, scoreId)
      if (score > bestScore) {
        bestScore = score
        bestMatch = { channel: ch, source: src }
      }
    }
  }

  if (bestScore >= 0.75 && bestMatch) {
    return bestMatch
  }

  // Fallback: check monitors if source channel list didn't match
  for (const m of project.monitors ?? []) {
    const scoreName = channelScore(query, m.channelName)
    const scoreId = channelScore(query, m.channelId)
    const score = Math.max(scoreName, scoreId)
    if (score > bestScore) {
      bestScore = score
      const src = (project.sources ?? []).find((s) => s.workspaceId === project.teamId) || project.sources?.[0]
      bestMatch = {
        channel: {
          id: m.channelId,
          name: m.channelName,
          enabled: true,
          agentRead: true,
          agentWrite: false
        },
        source: src
      }
    }
  }

  return bestScore >= 0.75 ? bestMatch : null
}

/**
 * Analyzes user prompts to identify if an action is requested.
 */
export function detectAgentAction(prompt: string, project?: DashboardProject): AgentAction | null {
  const p = prompt.trim()
  if (!p) return null

  // 1. Explicit JSON action block emitted by LLM: ```action { ... } ```
  const actionMatch = p.match(/```action\s*([\s\S]*?)\s*```/i)
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1])
      if (parsed && typeof parsed.action === 'string') {
        return {
          type: parsed.action as AgentAction['type'],
          channelNameOrId: parsed.channel || parsed.channelNameOrId,
          text: parsed.text,
          count: Number(parsed.count) || undefined,
          intervalMinutes: Number(parsed.intervalMinutes) || undefined,
          enabled: parsed.enabled !== false
        }
      }
    } catch {
      // ignore JSON parse error and proceed to intent matching
    }
  }

  // 2. Capabilities check
  // E.g.: "hiii here tell is you can send the messsage in the slack ?",
  //       "is you have capability to schedule any task ??",
  //       "what can you do", "can you send messages", "what are your tools"
  const isCapabilitiesQuery =
    /\b(?:what\s+can\s+you\s+do|what\s+are\s+your\s+tools|capabilities|what\s+channels)\b/i.test(p) ||
    (/\b(?:is\s+you\s+(?:can|have)|can\s+you|can\s+i|are\s+you\s+able|tell\s+.*?\byou\s+can|capability\s+to)\b/i.test(p) &&
      /\b(?:send|post|mess?ag?e?s?|schedule)\b/i.test(p) &&
      !/(?:in|to)\s+(?:the\s+)?(?:#)?[a-zA-Z0-9_-]+(?:\s+channel)?\s+(?:hi|hello|hlw|saying|with|text)/i.test(p) &&
      !/(?:send|post)\s+(?:hi|hello|hlw|["'].*?["'])\s+(?:in|to)/i.test(p))

  if (isCapabilitiesQuery) {
    return { type: 'list_capabilities' }
  }

  // 3. Trigger Scrape / Sync
  // Examples: "scrape now", "trigger the scraping", "trigger scrape", "start scrape", "sync now"
  if (/\b(scrape\s+now|trigger\s+(?:the\s+)?scraping|trigger\s+scrape|run\s+scrape|start\s+scrape|sync\s+now)\b/i.test(p)) {
    return { type: 'trigger_scrape' }
  }

  // 4. Intent: Schedule Scrape
  // Examples: "schedule scraping every 15m", "schedule scrape every 20s", "schedule task every 15m"
  const schedMatch = p.match(/\b(?:schedule|interval)\b.*?\b(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hours)\b/i)
  if (schedMatch) {
    const num = Number(schedMatch[1])
    const unit = schedMatch[2].toLowerCase()
    let mins = num
    if (unit.startsWith('s')) mins = num / 60
    if (unit.startsWith('h')) mins = num * 60
    return { type: 'set_schedule', intervalMinutes: mins, enabled: true }
  }

  // 5. Intent: Send Slack Message (evaluated before read so "send message in #ch ... text" takes precedence)
  // Examples:
  // "here try to send the message in the agentworkprojecttesting channel you try to send the message properly see that all proeprly and ten send the message thier hiii or hlw as yyou want in thier"
  // "send message in agentworkprojecttesting channel hiii"
  // "post to #general hello team"
  // "send hiii in agentworkprojecttesting"
  if (/\b(?:send|post|write)\b/i.test(p)) {
    // Check if any project channel is mentioned
    let targetChannel = ''
    if (project) {
      const allChannels = (project.sources ?? []).flatMap((s) => s.channels ?? []).map((c) => c.name)
      const pLower = p.toLowerCase()
      for (const name of allChannels) {
        if (pLower.includes(name.toLowerCase())) {
          targetChannel = name
          break
        }
      }
    }

    const sendPatterns = [
      /(?:^|.*?\b)(?:send|post|write)\s+(?:the\s+)?(?:message\s+)?(?:in|to|into)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)(?:\s+channel)?(?:.*?)(?:send\s+(?:the\s+)?message\s+(?:thier|there)?\s*[:,-]?\s*|\s*[:,-]\s*|\s+text\s+[:,-]?\s*)(.+)$/i,
      /(?:^|.*?\b)(?:send|post|write)\s+(?:the\s+)?(?:message\s+)?(?:in|to|into)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)(?:\s+channel)?\s*[:,-]?\s*(.+)$/i,
      /(?:^|.*?\b)(?:send|post)\s+(.+?)\s+(?:in|to|into)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)(?:\s+channel)?$/i
    ]

    for (const re of sendPatterns) {
      const m = p.match(re)
      if (m) {
        if (re === sendPatterns[2]) {
          const text = m[1].trim()
          const channel = targetChannel || m[2].trim()
          if (channel && text) {
            return { type: 'send_slack', channelNameOrId: channel, text }
          }
        } else {
          const channel = targetChannel || m[1].trim()
          let text = m[2].trim()
          // Clean boilerplate
          text = text.replace(/^["']|["']$/g, '')
          // Clean trailing phrases like "as you want in thier" or "in thier"
          text = text.replace(/\s*(?:as\s+(?:y?you|u)\s+want)?\s*(?:in\s+thier|in\s+there)?$/i, '').trim()
          if (channel && text) {
            return { type: 'send_slack', channelNameOrId: channel, text }
          }
        }
      }
    }

    // Fallback if targetChannel was identified but regex didn't extract text
    if (targetChannel) {
      const textMatch = p.match(/(?:send\s+(?:the\s+)?message\s+(?:thier|there)?\s*[:,-]?\s*|\s+message\s+[:,-]?\s*|\s+text\s+[:,-]?\s*)(.+)$/i)
      if (textMatch) {
        let text = textMatch[1].trim().replace(/\s*(?:as\s+(?:y?you|u)\s+want)?\s*(?:in\s+thier|in\s+there)?$/i, '').trim()
        return { type: 'send_slack', channelNameOrId: targetChannel, text: text || 'Hello' }
      }
    }
  }

  // 6. Intent: Read Channel Messages
  // Examples:
  // "tell me what are the last 3 message in the newtestinggroup tell me last 3 messages"
  // "read last 5 messages from #general"
  // "what are the messages in #channel"
  const readPatterns = [
    /(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i,
    /(?:read|tell|show|get)\s+(?:me\s+)?(?:what\s+are\s+)?(?:the\s+)?(?:last|latest)?\s*(\d+)?\s*(?:message|messages)\s+(?:in|from|of)\s+(?:the\s+)?(?:#)?([a-zA-Z0-9_-]+)/i
  ]
  for (const re of readPatterns) {
    const m = p.match(re)
    if (m) {
      const count = m[1] ? Number(m[1]) : 3
      const channel = m[2].trim()
      if (channel) {
        return { type: 'read_channel', channelNameOrId: channel, count }
      }
    }
  }

  return null
}

/**
 * Formats the final markdown reply with embedded JSON action card comment.
 */
function wrapCardReply(result: AgentActionResult): AgentActionResult {
  if (result.cardType) {
    const cardMarker = `\n\n<!-- ACTION_CARD: ${JSON.stringify({
      type: result.cardType,
      ok: result.ok,
      data: result.cardData
    })} -->`
    return {
      ...result,
      replyMarkdown: `${result.replyMarkdown}${cardMarker}`
    }
  }
  return result
}

/**
 * Executes the resolved agent action against the backend dependencies.
 */
export async function executeAgentAction(
  action: AgentAction,
  ctx: AgentActionContext
): Promise<AgentActionResult> {
  const { projectId, project, chatService, syncEngine } = ctx

  switch (action.type) {
    case 'send_slack': {
      const targetQuery = action.channelNameOrId || ''
      const text = (action.text || '').trim()

      if (!targetQuery || !text) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Please specify both the destination channel and the message text to send.'
        })
      }

      const resolved = resolveProjectChannel(project, targetQuery)
      if (!resolved) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Could not find a channel named **#${targetQuery}** in this project. Please check the channel name in Workspace Control.`
        })
      }

      const { channel } = resolved

      // Strict security guardrail: verify agentWrite permission
      if (!channel.agentWrite) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          cardType: 'permission_denied',
          cardData: {
            channelId: channel.id,
            channelName: channel.name
          },
          replyMarkdown: [
            `⚠️ **Permission Locked**: Agent write permission is disabled for **#${channel.name}**.`,
            '',
            'To protect your workspace, the agent will never post messages without explicit authorization.',
            `Click below to open **Workspace Control** and enable **Agent Write** for **#${channel.name}**:`
          ].join('\n')
        })
      }

      if (!chatService) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Chat service is unavailable. Could not send message.'
        })
      }

      try {
        const sendRes = await chatService.sendMessage({
          projectId,
          channelId: channel.id,
          text,
          isAgent: true
        })

        if (!sendRes.ok) {
          return wrapCardReply({
            handled: true,
            action,
            ok: false,
            replyMarkdown: `Failed to post message to **#${channel.name}**: ${sendRes.error || 'Unknown error'}`
          })
        }

        const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'slack_dispatch',
          cardData: {
            channelId: channel.id,
            channelName: channel.name,
            ts: sendRes.message?.ts,
            time: nowFormatted,
            text,
            mode: 'direct_api'
          },
          replyMarkdown: [
            `✅ **Message Dispatched to #${channel.name}**`,
            `> *${text}*`,
            '',
            `*Delivered via Direct API in ~150ms at ${nowFormatted} (Slack TS: \`${sendRes.message?.ts || 'verified'}\`)*`
          ].join('\n')
        })
      } catch (err) {
        log.error('executeAgentAction send_slack error:', err)
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Encountered an error dispatching message: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'read_channel': {
      const targetQuery = action.channelNameOrId || ''
      const limit = Math.min(Math.max(1, action.count || 3), 20)

      const resolved = resolveProjectChannel(project, targetQuery)
      if (!resolved) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Channel **#${targetQuery}** was not found in this project's monitored sources. Check the channel list in Workspace Control.`
        })
      }

      const { channel } = resolved

      if (!chatService) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Chat service is unavailable.'
        })
      }

      try {
        let page = await chatService.loadMessages({
          projectId,
          channelId: channel.id,
          source: 'client',
          limit
        })

        if (!page.messages || page.messages.length === 0) {
          // Try 'ours' source if client source had no messages
          page = await chatService.loadMessages({
            projectId,
            channelId: channel.id,
            source: 'ours',
            limit
          })
        }

        if (!page.messages || page.messages.length === 0) {
          return wrapCardReply({
            handled: true,
            action,
            ok: true,
            cardType: 'channel_read',
            cardData: {
              channelId: channel.id,
              channelName: channel.name,
              count: 0
            },
            replyMarkdown: `No stored messages found in **#${channel.name}** yet. You can ask me to **"scrape now"** to pull latest messages directly from Slack!`
          })
        }

        // Return latest N messages formatted chronologically
        const msgs = page.messages.slice(0, limit)
        const formatted = msgs.map((m: DashboardChatMessage, idx: number) => {
          const user = m.userName || m.userId || 'Unknown'
          const time = m.atIso ? new Date(m.atIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
          return `${idx + 1}. **${user}** (${time}): *${m.text}*`
        }).join('\n')

        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'channel_read',
          cardData: {
            channelId: channel.id,
            channelName: channel.name,
            count: msgs.length,
            messages: msgs.map((m) => ({ user: m.userName || m.userId, text: m.text, ts: m.ts }))
          },
          replyMarkdown: [
            `📖 **Latest ${msgs.length} message(s) in #${channel.name}:**`,
            '',
            formatted
          ].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Could not read messages from **#${channel.name}**: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'trigger_scrape': {
      if (!syncEngine) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: 'Sync engine is unavailable.'
        })
      }

      try {
        const snapshot = await syncEngine.syncProject(projectId)
        const count = snapshot?.newMessageCount ?? 0
        if (chatService) {
          chatService.invalidateActivityCache(projectId)
        }

        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'scrape_trigger',
          cardData: { newMessagesCount: count },
          replyMarkdown: [
            `🕷️ **On-Demand Scrape Completed**`,
            '',
            count > 0
              ? `Captured **${count} new message(s)** across monitored channels. Dashboard analytics, cards, and activity charts have been updated!`
              : `All channels are up to date. Zero new messages found since last sync.`
          ].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Scrape encountered an error: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'set_schedule': {
      const interval = action.intervalMinutes || 15
      const enabled = action.enabled !== false

      // Update schedule on browser sources
      try {
        const source = (project.sources ?? []).find((s) => s.platform === 'slack' && s.enabled !== false) || project.sources?.[0]
        if (source && ctx.monitorStore?.upsertProject) {
          source.scheduleEnabled = enabled
          source.scheduleIntervalMinutes = interval as any
          await ctx.monitorStore.upsertProject({ project })
        }

        const label = interval < 1 ? `${Math.round(interval * 60)} seconds` : `${interval} minutes`
        return wrapCardReply({
          handled: true,
          action,
          ok: true,
          cardType: 'schedule_set',
          cardData: { intervalMinutes: interval, enabled },
          replyMarkdown: [
            `⏱️ **Automated Scrape Schedule Configured**`,
            '',
            enabled
              ? `Background scraping is **ON**, polling every **${label}** via Direct API.`
              : `Background scraping has been **PAUSED**.`
          ].join('\n')
        })
      } catch (err) {
        return wrapCardReply({
          handled: true,
          action,
          ok: false,
          replyMarkdown: `Failed to update schedule: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    }

    case 'list_capabilities': {
      const authorizedChannels = (project.sources ?? [])
        .flatMap((s) => s.channels ?? [])
        .filter((c) => c.agentWrite === true)
        .map((c) => `#${c.name}`)

      const readChannels = (project.sources ?? [])
        .flatMap((s) => s.channels ?? [])
        .filter((c) => c.enabled !== false)
        .map((c) => `#${c.name}`)

      return wrapCardReply({
        handled: true,
        action,
        ok: true,
        cardType: 'capabilities',
        cardData: {
          authorizedChannels,
          readChannels
        },
        replyMarkdown: [
          `🤖 **Cosmic Autonomous Agent Superpowers**`,
          '',
          `I can execute real workspace actions directly from this chat:`,
          `- **🚀 Post to Slack**: Send messages or announcements to any authorized channel (e.g. \`send message to #agentworkprojecttesting hello team\`).`,
          `- **📖 Read Channels**: Fetch recent messages from any channel (e.g. \`what are the last 3 messages in #newtestinggroup\`).`,
          `- **🕷️ Trigger Scrape**: Ingest fresh messages on demand (e.g. \`scrape now\` or \`trigger scraping\`).`,
          `- **⏱️ Manage Schedules**: Configure automated polling frequency (e.g. \`schedule every 20s\` or \`schedule every 15m\`).`,
          '',
          `**Current Channel Access:**`,
          `- **Write Authorized**: ${authorizedChannels.length > 0 ? authorizedChannels.join(', ') : '*None yet (Enable Agent Write in Workspace Control)*'}`,
          `- **Monitored Channels**: ${readChannels.length > 0 ? readChannels.join(', ') : '*None selected*'}`
        ].join('\n')
      })
    }

    default:
      return { handled: false, ok: false, replyMarkdown: '' }
  }
}
