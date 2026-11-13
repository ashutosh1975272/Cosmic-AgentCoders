import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DashboardSource } from '../../shared/dashboard-contract'

export interface DashboardStoredMessage {
  ts: string
  user?: string
  text?: string
  /** message subtype (e.g. 'bot_message', 'message_changed') */
  subtype?: string
  /** slack permalink/url if available */
  permalink?: string
  /** Which workspace this message came from. Absent on rows stored before v3. */
  source?: DashboardSource
  /** Thread parent ts when this message is a reply. */
  threadTs?: string
  /** Reply count Slack reported on the thread parent. */
  replyCount?: number
}

export interface StoredChannelRef {
  id: string
  name: string
}

export interface StoredChannelDelta {
  channel: StoredChannelRef
  messages: DashboardStoredMessage[]
  /** newest message ts */
  cursor: string
  lastSyncAt: string
}

export interface AppendOnlyResult {
  added: number
  cursor: string
  lastSyncAt: string
}

/** Numeric Slack ts comparator (ts are either "N" or "N.M" strings). */
export function compareTs(a: string, b: string): number {
  const an = Number(a)
  const bn = Number(b)
  if (an > bn) return 1
  if (an < bn) return -1
  return 0
}

export class DashboardDeltaStore {
  readonly rootDir: string

  constructor(options: { rootDir: string }) {
    this.rootDir = options.rootDir
  }

  private channelFilePath(profileId: string, teamId: string, channelId: string): string {
    return join(this.rootDir, 'channels', profileId, teamId, `${channelId}.json`)
  }

  async load(
    profileId: string,
    teamId: string,
    channelId: string
  ): Promise<StoredChannelDelta | null> {
    const filePath = this.channelFilePath(profileId, teamId, channelId)
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as StoredChannelDelta
      if (!parsed || !Array.isArray(parsed.messages)) return null

      // Check if self-healing or deduplication is needed
      let dirty = false

      const hasInvalidTs = parsed.messages.some((m) => {
        if (!m || typeof m.ts !== 'string' || m.ts === 'NaN') return true
        const n = Number(m.ts)
        return isNaN(n) || !isFinite(n)
      })

      const cursorNum = Number(parsed.cursor)
      const hasInvalidCursor =
        !parsed.cursor ||
        parsed.cursor === 'NaN' ||
        isNaN(cursorNum) ||
        !isFinite(cursorNum)

      if (hasInvalidTs || hasInvalidCursor) {
        dirty = true

        let baseEpoch = 0
        if (parsed.lastSyncAt) {
          const t = new Date(parsed.lastSyncAt).getTime()
          if (!isNaN(t) && isFinite(t)) {
            baseEpoch = t / 1000
          }
        }
        if (baseEpoch <= 0) {
          try {
            const s = await stat(filePath)
            if (s.mtimeMs && !isNaN(s.mtimeMs)) {
              baseEpoch = s.mtimeMs / 1000
            }
          } catch {
            // Ignore stat error
          }
        }
        if (baseEpoch <= 0) {
          baseEpoch = Date.now() / 1000
        }

        // Heal invalid timestamps
        for (let i = 0; i < parsed.messages.length; i++) {
          const m = parsed.messages[i]
          if (!m) continue
          const n = Number(m.ts)
          if (!m.ts || m.ts === 'NaN' || isNaN(n) || !isFinite(n)) {
            const offset = (parsed.messages.length - 1 - i) * 60 - i * 0.001
            m.ts = (baseEpoch - offset).toFixed(6)
          }
          if (!m.user) m.user = 'Contact'
          if (m.text === undefined || m.text === null) m.text = ''
          if (!m.source) m.source = 'client'
        }
      }

      // Deduplicate messages on disk (by ts or exact duplicates)
      const seenTs = new Set<string>()
      const uniqueMessages: DashboardStoredMessage[] = []
      for (const m of parsed.messages) {
        if (!m) continue
        if (seenTs.has(m.ts)) {
          dirty = true
          continue
        }
        seenTs.add(m.ts)
        uniqueMessages.push(m)
      }
      if (uniqueMessages.length !== parsed.messages.length) {
        parsed.messages = uniqueMessages
        dirty = true
      }

      // Sort messages in ascending order
      parsed.messages.sort((a, b) => compareTs(a.ts, b.ts))

      const newest = parsed.messages.at(-1)
      const expectedCursor = newest ? newest.ts : '0'
      if (parsed.cursor !== expectedCursor) {
        parsed.cursor = expectedCursor
        dirty = true
      }

      // If repaired, write back to disk atomically
      if (dirty) {
        try {
          const tmpPath = `${filePath}.tmp`
          await writeFile(tmpPath, JSON.stringify(parsed, null, 2), 'utf8')
          await rename(tmpPath, filePath)
        } catch {
          // If disk write fails, return repaired in-memory object
        }
      }

      return parsed
    } catch {
      return null
    }
  }

  async appendMessages(input: {
    profileId: string
    teamId: string
    channelId: string
    channelName: string
    messages: DashboardStoredMessage[]
    /** Workspace tag stored on every message (default 'client' for old callers). */
    source?: DashboardSource
    now?: string
  }): Promise<AppendOnlyResult> {
    const path = this.channelFilePath(input.profileId, input.teamId, input.channelId)
    let delta: StoredChannelDelta
    const existing = await this.load(input.profileId, input.teamId, input.channelId)
    if (existing) {
      delta = existing
      if (existing.channel.name !== input.channelName) {
        delta.channel = { id: input.channelId, name: input.channelName }
      }
    } else {
      delta = {
        channel: { id: input.channelId, name: input.channelName },
        messages: [],
        cursor: input.messages.at(-1)?.ts ?? '0',
        lastSyncAt: input.now ?? new Date().toISOString()
      }
    }

    const seen = new Set(delta.messages.map((m) => m.ts))
    let added = 0
    for (const m of input.messages) {
      if (!m || typeof m.ts !== 'string' || seen.has(m.ts)) continue
      seen.add(m.ts)
      delta.messages.push({
        ts: m.ts,
        user: m.user,
        text: m.text,
        subtype: m.subtype,
        permalink: m.permalink,
        source: m.source ?? input.source ?? 'client',
        threadTs: m.threadTs,
        replyCount: m.replyCount
      })
      added += 1
    }
    delta.messages.sort((a, b) => compareTs(a.ts, b.ts))
    const newest = delta.messages.at(-1)
    delta.cursor = newest ? newest.ts : '0'
    delta.lastSyncAt = input.now ?? new Date().toISOString()

    await mkdir(join(path, '..'), { recursive: true })
    const tmpPath = `${path}.tmp`
    await writeFile(tmpPath, JSON.stringify(delta), 'utf8')
    await rename(tmpPath, path)

    return {
      added,
      cursor: delta.cursor,
      lastSyncAt: delta.lastSyncAt
    }
  }

  /** messages after (not incl.) a given ts, newest last */
  async messagesSince(
    profileId: string,
    teamId: string,
    channelId: string,
    sinceTs?: string
  ): Promise<DashboardStoredMessage[]> {
    const delta = await this.load(profileId, teamId, channelId)
    if (!delta) return []
    if (!sinceTs) return delta.messages
    return delta.messages.filter((m) => compareTs(m.ts, sinceTs) > 0)
  }

  async getNetNewSinceCursor(
    profileId: string,
    teamId: string,
    channelId: string,
    atTs: string
  ): Promise<{ count: number; ts: string[] }> {
    const msgs = await this.messagesSince(profileId, teamId, channelId, atTs)
    return { count: msgs.length, ts: msgs.map((m) => m.ts) }
  }

  async readSnapshotMeta(
    profileId: string,
    teamId: string,
    channelId: string
  ): Promise<{ cursor: string; lastSyncAt: string; messageCount: number } | null> {
    const delta = await this.load(profileId, teamId, channelId)
    if (!delta) return null
    return {
      cursor: delta.cursor,
      lastSyncAt: delta.lastSyncAt,
      messageCount: delta.messages.length
    }
  }

  async deleteAllForProfileTeam(profileId: string, teamId: string): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises')
      await rm(join(this.rootDir, 'channels', profileId, teamId), {
        recursive: true,
        force: true
      })
    } catch {
      /* ignore */
    }
  }

  async listForProfile(profileId: string): Promise<StoredChannelDelta[]> {
    try {
      const { readdir } = await import('node:fs/promises')
      const teamsDir = join(this.rootDir, 'channels', profileId)
      const teamIds = await readdir(teamsDir)
      const out: StoredChannelDelta[] = []
      for (const teamId of teamIds) {
        const channels = await readdir(join(teamsDir, teamId))
        for (const file of channels) {
          if (!file.endsWith('.json')) continue
          const parsed = await this.load(profileId, teamId, file.replace(/\.json$/, ''))
          if (parsed) out.push(parsed)
        }
      }
      return out
    } catch {
      return []
    }
  }
}
