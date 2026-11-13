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
 * Robustly parses a raw Teams timestamp into standard epoch seconds ("<seconds>.<micros>").
 * Never returns "NaN".
 */
export function parseTeamsTimestamp(raw: string | number | undefined | null): string {
  const fallback = (): string => (Date.now() / 1000).toFixed(6)

  if (raw === undefined || raw === null) {
    return fallback()
  }

  if (typeof raw === 'number') {
    if (isNaN(raw) || !isFinite(raw) || raw <= 0) return fallback()
    if (raw > 1e11) {
      return (raw / 1000).toFixed(6)
    }
    return raw.toFixed(6)
  }

  let s = String(raw).trim()
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
    return fallback()
  }

  // Strip invisible directional characters and zero-width spaces
  s = s.replace(/[\u200e\u200f\u202a-\u202e\uFEFF]/g, '').trim()
  s = s.replace(/^[\[\(]+|[\]\)]+$/g, '').trim()
  s = s.replace(/^["']+|["']+$/g, '').trim()

  // 1. Pure numeric string
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const num = Number(s)
    if (!isNaN(num) && isFinite(num) && num > 0) {
      if (num > 1e11) {
        return (num / 1000).toFixed(6)
      }
      return num.toFixed(6)
    }
  }

  const parseClock = (
    str: string
  ): { hours: number; minutes: number; seconds: number } | null => {
    const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i)
    if (!m) return null
    let hours = parseInt(m[1], 10)
    const minutes = parseInt(m[2], 10)
    const seconds = m[3] ? parseInt(m[3], 10) : 0
    const mer = m[4]?.toLowerCase()
    if (mer === 'pm' && hours < 12) hours += 12
    if (mer === 'am' && hours === 12) hours = 0
    return { hours, minutes, seconds }
  }

  const sLower = s.toLowerCase()

  // 2. Relative keywords: "yesterday", "today", or day names
  if (sLower.includes('yesterday')) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const clock = parseClock(s)
    if (clock) {
      d.setHours(clock.hours, clock.minutes, clock.seconds, 0)
    } else {
      d.setHours(12, 0, 0, 0)
    }
    const t = d.getTime()
    if (!isNaN(t) && isFinite(t)) return (t / 1000).toFixed(6)
  }

  if (sLower.includes('today')) {
    const d = new Date()
    const clock = parseClock(s)
    if (clock) {
      d.setHours(clock.hours, clock.minutes, clock.seconds, 0)
    }
    const t = d.getTime()
    if (!isNaN(t) && isFinite(t)) return (t / 1000).toFixed(6)
  }

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (let i = 0; i < daysOfWeek.length; i++) {
    const dayName = daysOfWeek[i]
    if (sLower.startsWith(dayName) || sLower.includes(` ${dayName}`)) {
      const d = new Date()
      const currentDay = d.getDay()
      let diff = currentDay - i
      if (diff <= 0) diff += 7
      d.setDate(d.getDate() - diff)
      const clock = parseClock(s)
      if (clock) {
        d.setHours(clock.hours, clock.minutes, clock.seconds, 0)
      } else {
        d.setHours(12, 0, 0, 0)
      }
      const t = d.getTime()
      if (!isNaN(t) && isFinite(t)) return (t / 1000).toFixed(6)
    }
  }

  // 3. Clock-only strings (e.g. "09:20 PM", "9:20 pm", "14:30")
  const clockOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (clockOnly) {
    const clock = parseClock(s)
    if (clock) {
      const now = new Date()
      now.setHours(clock.hours, clock.minutes, clock.seconds, 0)
      let time = now.getTime()
      if (time > Date.now() + 60_000) {
        time -= 86_400_000
      }
      if (!isNaN(time) && isFinite(time)) {
        return (time / 1000).toFixed(6)
      }
    }
  }

  // 4. Composite date + time strings
  const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)/i
  const dateRegex = /(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})/

  const tMatch = s.match(timeRegex)
  const dMatch = s.match(dateRegex)

  if (dMatch) {
    const dateParts = dMatch[1].split(/[-/.]/).map((p) => parseInt(p, 10))
    let year = 0
    let month = 0
    let day = 0

    if (dateParts[0] >= 1970) {
      year = dateParts[0]
      month = dateParts[1]
      day = dateParts[2]
    } else if (dateParts[2] >= 1970) {
      year = dateParts[2]
      if (dateParts[0] > 12) {
        day = dateParts[0]
        month = dateParts[1]
      } else if (dateParts[1] > 12) {
        month = dateParts[0]
        day = dateParts[1]
      } else {
        day = dateParts[0]
        month = dateParts[1]
      }
    } else if (dateParts[2] < 100) {
      year = 2000 + dateParts[2]
      if (dateParts[0] > 12) {
        day = dateParts[0]
        month = dateParts[1]
      } else if (dateParts[1] > 12) {
        month = dateParts[0]
        day = dateParts[1]
      } else {
        day = dateParts[0]
        month = dateParts[1]
      }
    }

    let hours = 0
    let minutes = 0
    let seconds = 0
    if (tMatch) {
      const clock = parseClock(tMatch[1])
      if (clock) {
        hours = clock.hours
        minutes = clock.minutes
        seconds = clock.seconds
      }
    }

    if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsedDate = new Date(year, month - 1, day, hours, minutes, seconds, 0)
      const time = parsedDate.getTime()
      if (!isNaN(time) && isFinite(time)) {
        return (time / 1000).toFixed(6)
      }
    }
  }

  // 5. Fallback to standard Date.parse
  const parsed = new Date(s).getTime()
  if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) {
    return (parsed / 1000).toFixed(6)
  }

  return fallback()
}

/**
 * Normalizes raw Teams message data into Orbit's standardized DashboardStoredMessage.
 */
export function normalizeTeamsMessage(
  raw: RawTeamsMessage,
  _channelId?: string
): DashboardStoredMessage {
  void _channelId
  const ts = parseTeamsTimestamp(raw.timestamp)

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
