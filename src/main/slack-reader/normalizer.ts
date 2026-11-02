import { createHash } from 'node:crypto'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface RawScrapedMessage {
  rawTs?: string | number
  sender?: string
  text?: string
  threadTs?: string
  permalink?: string
  replyCount?: number
}

/**
 * Creates a unique deterministic hash for deduplicating messages across polling cycles.
 */
export function createMessageHash(
  workspaceId: string,
  channelId: string,
  ts: string
): string {
  return createHash('sha256')
    .update(`${workspaceId.trim()}|${channelId.trim()}|${ts.trim()}`, 'utf8')
    .digest('hex')
}

export function cleanMessageText(rawText: string | undefined): string {
  if (!rawText) return ''
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\u200B/g, ' ') // zero-width space -> space
    .replace(/[\u200C\u200D\uFEFF]/g, '') // zero-width joiner/non-joiner/bom
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * Normalizes Slack DOM timestamps to Slack-compatible epoch seconds strings (e.g. 1730000000.123456).
 * Returns null if the timestamp cannot be reliably parsed.
 * (Rule: do NOT invent fake epoch or today timestamps if missing).
 */
export function normalizeSlackTimestamp(rawTs?: string | number): string | null {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
    const seconds = rawTs > 1e11 ? rawTs / 1000 : rawTs
    return seconds.toFixed(6)
  }

  if (typeof rawTs === 'string') {
    const trimmed = rawTs.trim()
    if (!trimmed) return null

    // Exact Slack numeric timestamp format: 10+ digits with optional decimal fraction
    if (/^\d{10}(?:\.\d+)?$/.test(trimmed)) {
      return trimmed.includes('.') ? trimmed : `${trimmed}.000000`
    }

    // Epoch milliseconds in string
    if (/^\d{13}$/.test(trimmed)) {
      return (Number(trimmed) / 1000).toFixed(6)
    }

    // Permalink 'p1730630000000100' format
    const pMatch = trimmed.match(/^p?(\d{10})(\d{6})$/)
    if (pMatch) {
      return `${pMatch[1]}.${pMatch[2]}`
    }

    // Try parsing ISO/date string
    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return (parsed / 1000).toFixed(6)
    }
  }

  return null
}

/**
 * Normalizes a raw scraped DOM message into the standard DashboardStoredMessage schema.
 * Returns null if required fields (like timestamp) are missing.
 */
export function normalizeScrapedMessage(
  raw: RawScrapedMessage,
  _channelId: string
): DashboardStoredMessage | null {
  const ts = normalizeSlackTimestamp(raw.rawTs)
  if (!ts) {
    // Hard rule: if timestamp cannot be determined from DOM, skip message to avoid corrupting time ordering
    return null
  }

  const text = cleanMessageText(raw.text)
  const user = (raw.sender ?? 'Anonymous').trim() || 'Anonymous'

  const message: DashboardStoredMessage = {
    ts,
    user,
    text,
    source: 'client'
  }

  if (raw.threadTs) {
    const normThread = normalizeSlackTimestamp(raw.threadTs)
    if (normThread) message.threadTs = normThread
  }

  if (raw.permalink) {
    message.permalink = raw.permalink
  }

  if (typeof raw.replyCount === 'number' && raw.replyCount > 0) {
    message.replyCount = raw.replyCount
  }

  return message
}

/**
 * Deduplicates messages within a channel using (workspaceId, channelId, ts).
 */
export function deduplicateMessages(
  workspaceId: string,
  channelId: string,
  messages: DashboardStoredMessage[]
): DashboardStoredMessage[] {
  const seen = new Set<string>()
  const deduped: DashboardStoredMessage[] = []

  for (const msg of messages) {
    const hash = createMessageHash(workspaceId, channelId, msg.ts)
    if (!seen.has(hash)) {
      seen.add(hash)
      deduped.push(msg)
    }
  }

  return deduped.sort((a, b) => Number(a.ts) - Number(b.ts))
}
