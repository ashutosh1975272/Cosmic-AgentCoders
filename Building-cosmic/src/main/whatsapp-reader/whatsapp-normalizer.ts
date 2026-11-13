import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface RawWhatsAppMessage {
  id: string
  chatId: string
  senderId?: string
  senderName?: string
  text: string
  timestamp: string | number
  fromMe?: boolean
  isGroup?: boolean
}

/**
 * Robustly parses a raw WhatsApp timestamp (epoch number, numeric string, clock-only string,
 * or international composite date string) into a standard epoch seconds string ("<seconds>.<micros>").
 * Never returns "NaN".
 */
export function parseWhatsAppTimestamp(raw: string | number | undefined | null): string {
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

  // Strip invisible directional characters and zero-width spaces (WhatsApp Web LTR/RTL marks)
  s = s.replace(/[\u200e\u200f\u202a-\u202e\uFEFF]/g, '').trim()
  // Strip enclosing brackets e.g. "[9:20 PM, 13/11/2026]" -> "9:20 PM, 13/11/2026"
  s = s.replace(/^[\[\(]+|[\]\)]+$/g, '').trim()
  // Strip quotes if present
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

  // 2. Relative keywords: "yesterday", "today", or day names (e.g. "Yesterday, 09:20 PM", "Today at 14:30")
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

  // 3. Clock-only strings (e.g. "09:20 PM", "9:20 pm", "14:30", "09:20:15")
  const clockOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (clockOnly) {
    const clock = parseClock(s)
    if (clock) {
      const now = new Date()
      now.setHours(clock.hours, clock.minutes, clock.seconds, 0)
      let time = now.getTime()
      // If the clock time falls in the future (by > 60s), it belongs to yesterday's cycle
      if (time > Date.now() + 60_000) {
        time -= 86_400_000
      }
      if (!isNaN(time) && isFinite(time)) {
        return (time / 1000).toFixed(6)
      }
    }
  }

  // 4. Composite date + time strings (e.g. "13/11/2026, 09:20", "13/11/26, 09:20", "9:20 PM, 13/11/2026", "2026-11-13 14:30")
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
      // YYYY-MM-DD
      year = dateParts[0]
      month = dateParts[1]
      day = dateParts[2]
    } else if (dateParts[2] >= 1970) {
      // DD/MM/YYYY or MM/DD/YYYY
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
      // 2-digit year (e.g. 26 -> 2026)
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
 * Normalizes raw WhatsApp message data into Orbit's standardized DashboardStoredMessage.
 */
export function normalizeWhatsAppMessage(
  raw: RawWhatsAppMessage,
  _chatId?: string
): DashboardStoredMessage {
  void _chatId
  const ts = parseWhatsAppTimestamp(raw.timestamp)

  const cleanText = (raw.text || '')
    .replace(/<[^>]+>/g, '')
    .trim()

  return {
    ts,
    user: raw.senderName || (raw.fromMe ? 'You' : 'WhatsApp Contact'),
    text: cleanText,
    source: raw.fromMe ? 'ours' : 'client'
  }
}
