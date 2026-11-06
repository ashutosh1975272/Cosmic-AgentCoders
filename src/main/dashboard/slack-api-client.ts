import type { DashboardStoredMessage } from './delta-store'
import type { SlackSessionCredentials } from '../slack-reader/session-token-extractor'
import { reportSlackRateLimit, slackTokenKey, withSlackLimit } from './slack-throttle'
import { log } from '../logging'

export interface DirectApiChannelOptions {
  channelId: string
  /** Epoch seconds floor. 0 = default page limit. */
  sinceTs?: number
  /** Maximum number of messages to fetch in one sync run. Default 1000. */
  maxMessages?: number
  signal?: AbortSignal
}

export interface DirectApiFetchResult {
  messages: DashboardStoredMessage[]
  oldestTs: number | null
  newestTs: number | null
  hasMore: boolean
}

export class SlackApiClient {
  private readonly credentials: SlackSessionCredentials

  constructor(credentials: SlackSessionCredentials) {
    this.credentials = credentials
  }

  private async fetchApi(
    method: string,
    params: Record<string, string>,
    signal?: AbortSignal
  ): Promise<any> {
    const token = this.credentials.token
    const cookie = this.credentials.cookie

    const bodyParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        bodyParams.append(key, value)
      }
    }

    return withSlackLimit(slackTokenKey(token), async () => {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `d=${cookie}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyParams
      })

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
        const waitMs = (Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : 1) * 1000
        reportSlackRateLimit(slackTokenKey(token), waitMs)
        const err = new Error(`slack ${method}: ratelimited (429)`)
        ;(err as any).slackError = 'ratelimited'
        throw err
      }

      const body = (await res.json()) as any
      if (!body.ok) {
        const err = new Error(`slack ${method} failed: ${body.error || 'unknown_error'}`)
        ;(err as any).slackError = body.error
        throw err
      }
      return body
    })
  }

  /**
   * Fetches messages from a Slack channel using direct conversations.history API.
   * Paginates backwards/incrementally to cover the sinceTs window.
   */
  async fetchChannelMessages(
    options: DirectApiChannelOptions
  ): Promise<DirectApiFetchResult> {
    const { channelId, sinceTs = 0, maxMessages = 3000, signal } = options
    const collected: DashboardStoredMessage[] = []
    let cursor: string | undefined = undefined
    let hasMore = false

    // Slack returns messages in reverse-chronological order (newest first).
    // oldest parameter restricts messages to those after sinceTs.
    const oldestParam = sinceTs > 0 ? String(sinceTs) : undefined

    let pageCount = 0
    const maxPages = Math.ceil(maxMessages / 200)

    while (pageCount < maxPages && !signal?.aborted) {
      pageCount++
      const params: Record<string, string> = {
        channel: channelId,
        limit: '200'
      }
      if (oldestParam) params.oldest = oldestParam
      if (cursor) params.cursor = cursor

      let body: any
      try {
        body = await this.fetchApi('conversations.history', params, signal)
      } catch (err: any) {
        log.info(`[slack-api-client] error fetching history for ${channelId}:`, {
          error: err.message,
          slackError: err.slackError
        })
        throw err
      }

      const rawList = Array.isArray(body.messages) ? body.messages : []
      if (rawList.length === 0) {
        break
      }

      for (const raw of rawList) {
        if (!raw.ts) continue
        // Filter out channel join/leave subtypes if desired, or keep as system messages
        const user =
          raw.user_profile?.display_name ||
          raw.user_profile?.real_name ||
          raw.username ||
          raw.user ||
          'Anonymous'

        const msg: DashboardStoredMessage = {
          ts: String(raw.ts),
          user: String(user).trim() || 'Anonymous',
          text: String(raw.text || '').trim(),
          source: 'client'
        }

        if (raw.thread_ts) msg.threadTs = String(raw.thread_ts)
        if (typeof raw.reply_count === 'number' && raw.reply_count > 0) {
          msg.replyCount = raw.reply_count
        }

        collected.push(msg)
        if (collected.length >= maxMessages) break
      }

      hasMore = Boolean(body.has_more)
      cursor = body.response_metadata?.next_cursor
      if (!hasMore || !cursor || collected.length >= maxMessages) {
        break
      }
    }

    // Sort chronologically ascending (oldest first)
    collected.sort((a, b) => Number(a.ts) - Number(b.ts))

    const oldestTs = collected.length > 0 ? Number(collected[0].ts) : null
    const newestTs = collected.length > 0 ? Number(collected[collected.length - 1].ts) : null

    return {
      messages: collected,
      oldestTs,
      newestTs,
      hasMore
    }
  }

  /**
   * Expands replies for a thread parent.
   */
  async fetchThreadReplies(
    channelId: string,
    threadTs: string,
    signal?: AbortSignal
  ): Promise<DashboardStoredMessage[]> {
    try {
      const body = await this.fetchApi(
        'conversations.replies',
        { channel: channelId, ts: threadTs, limit: '100' },
        signal
      )

      const rawList = Array.isArray(body.messages) ? body.messages : []
      const replies: DashboardStoredMessage[] = []

      for (const raw of rawList) {
        if (!raw.ts || raw.ts === threadTs) continue // skip parent
        const user =
          raw.user_profile?.display_name ||
          raw.user_profile?.real_name ||
          raw.username ||
          raw.user ||
          'Anonymous'

        replies.push({
          ts: String(raw.ts),
          user: String(user).trim() || 'Anonymous',
          text: String(raw.text || '').trim(),
          source: 'client',
          threadTs
        })
      }

      replies.sort((a, b) => Number(a.ts) - Number(b.ts))
      return replies
    } catch {
      return []
    }
  }
}
