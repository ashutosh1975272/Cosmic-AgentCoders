import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface RawTeamsMessage {
  id: string
  channelId: string
  senderId?: string
  senderName?: string
  text: string
  timestamp: string | number
  isBot?: boolean
  threadId?: string
  replyCount?: number
}

/**
 * Normalizes raw Teams message data into Orbit's standardized DashboardStoredMessage.
 */
export function normalizeTeamsMessage(
  raw: RawTeamsMessage,
  _channelId?: string
): DashboardStoredMessage {
  void _channelId
  const ts =
    typeof raw.timestamp === 'number'
      ? (raw.timestamp / 1000).toFixed(6)
      : !isNaN(Number(raw.timestamp))
        ? raw.timestamp
        : (new Date(raw.timestamp).getTime() / 1000).toFixed(6)

  // Clean html tags from Teams web if present (e.g. <p>...</p>, <at>...</at>)
  const cleanText = (raw.text || '')
    .replace(/<at[^>]*>([^<]+)<\/at>/gi, '@$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

  return {
    ts,
    user: raw.senderName || raw.senderId || 'Teams Member',
    text: cleanText,
    subtype: raw.isBot ? 'bot_message' : undefined,
    threadTs: raw.threadId,
    replyCount: raw.replyCount,
    source: 'client'
  }
}
