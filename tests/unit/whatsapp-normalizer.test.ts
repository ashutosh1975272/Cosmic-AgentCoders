import { describe, expect, it } from 'vitest'
import {
  normalizeWhatsAppMessage,
  parseWhatsAppTimestamp
} from '../../src/main/whatsapp-reader/whatsapp-normalizer'
import { parseTeamsTimestamp } from '../../src/main/teams-reader/teams-normalizer'

describe('parseWhatsAppTimestamp & normalizeWhatsAppMessage', () => {
  it('correctly parses numeric epoch ms and seconds', () => {
    const ts1 = parseWhatsAppTimestamp(1731456200000)
    expect(ts1).toBe('1731456200.000000')

    const ts2 = parseWhatsAppTimestamp('1731456200.500000')
    expect(ts2).toBe('1731456200.500000')
  })

  it('correctly parses clock-only strings using local calendar date', () => {
    const ts1 = parseWhatsAppTimestamp('09:20 PM')
    expect(ts1).not.toBe('NaN')
    expect(Number(ts1)).toBeGreaterThan(1700000000)

    const date = new Date(Number(ts1) * 1000)
    expect(date.getHours()).toBe(21)
    expect(date.getMinutes()).toBe(20)

    const ts2 = parseWhatsAppTimestamp('14:30')
    expect(ts2).not.toBe('NaN')
    const date2 = new Date(Number(ts2) * 1000)
    expect(date2.getHours()).toBe(14)
    expect(date2.getMinutes()).toBe(30)
  })

  it('correctly parses composite international date strings (DD/MM/YYYY and MM/DD/YYYY)', () => {
    const ts1 = parseWhatsAppTimestamp('13/11/2026, 09:20')
    expect(ts1).not.toBe('NaN')
    const date1 = new Date(Number(ts1) * 1000)
    expect(date1.getFullYear()).toBe(2026)
    expect(date1.getMonth()).toBe(10) // 10 is November (0-indexed)
    expect(date1.getDate()).toBe(13)
    expect(date1.getHours()).toBe(9)
    expect(date1.getMinutes()).toBe(20)

    const ts2 = parseWhatsAppTimestamp('9:20 PM, 13/11/2026')
    expect(ts2).not.toBe('NaN')
    const date2 = new Date(Number(ts2) * 1000)
    expect(date2.getFullYear()).toBe(2026)
    expect(date2.getMonth()).toBe(10)
    expect(date2.getDate()).toBe(13)
    expect(date2.getHours()).toBe(21)
    expect(date2.getMinutes()).toBe(20)
  })

  it('strips enclosing brackets and Unicode directional marks from WhatsApp timestamps', () => {
    const ts = parseWhatsAppTimestamp('\u200e[9:20 PM, 13/11/2026]\u200e')
    expect(ts).not.toBe('NaN')
    const date = new Date(Number(ts) * 1000)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getDate()).toBe(13)
    expect(date.getHours()).toBe(21)
    expect(date.getMinutes()).toBe(20)
  })

  it('correctly parses 2-digit international year formats (e.g. 13/11/26)', () => {
    const ts = parseWhatsAppTimestamp('13/11/26, 09:20')
    expect(ts).not.toBe('NaN')
    const date = new Date(Number(ts) * 1000)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(10) // Nov
    expect(date.getDate()).toBe(13)
    expect(date.getHours()).toBe(9)
    expect(date.getMinutes()).toBe(20)
  })

  it('correctly parses relative date strings: Yesterday, Today, and weekdays', () => {
    const tsYesterday = parseWhatsAppTimestamp('Yesterday, 09:20 PM')
    expect(tsYesterday).not.toBe('NaN')
    const dateY = new Date(Number(tsYesterday) * 1000)
    const expectedYesterday = new Date()
    expectedYesterday.setDate(expectedYesterday.getDate() - 1)
    expect(dateY.getDate()).toBe(expectedYesterday.getDate())
    expect(dateY.getHours()).toBe(21)
    expect(dateY.getMinutes()).toBe(20)

    const tsToday = parseWhatsAppTimestamp('Today at 10:15 AM')
    expect(tsToday).not.toBe('NaN')
    const dateT = new Date(Number(tsToday) * 1000)
    expect(dateT.getHours()).toBe(10)
    expect(dateT.getMinutes()).toBe(15)

    const tsMonday = parseWhatsAppTimestamp('Monday, 08:30')
    expect(tsMonday).not.toBe('NaN')
    const dateM = new Date(Number(tsMonday) * 1000)
    expect(dateM.getDay()).toBe(1) // Monday is day 1
    expect(dateM.getHours()).toBe(8)
    expect(dateM.getMinutes()).toBe(30)
  })

  it('safely falls back to valid finite timestamp on "NaN", empty or invalid inputs', () => {
    const tsNan = parseWhatsAppTimestamp('NaN')
    expect(tsNan).not.toBe('NaN')
    expect(isNaN(Number(tsNan))).toBe(false)
    expect(Number(tsNan)).toBeGreaterThan(1700000000)

    const tsEmpty = parseWhatsAppTimestamp('')
    expect(tsEmpty).not.toBe('NaN')
    expect(Number(tsEmpty)).toBeGreaterThan(1700000000)

    const tsNull = parseWhatsAppTimestamp(null)
    expect(tsNull).not.toBe('NaN')
    expect(Number(tsNull)).toBeGreaterThan(1700000000)

    const tsUndef = parseWhatsAppTimestamp(undefined)
    expect(tsUndef).not.toBe('NaN')
    expect(Number(tsUndef)).toBeGreaterThan(1700000000)
  })

  it('normalizes raw WhatsApp message without timestamp corruption', () => {
    const msg = normalizeWhatsAppMessage({
      id: 'wa_1',
      chatId: 'wa_talent_killer___',
      senderName: 'Talent Killer',
      text: 'Hello world',
      timestamp: '09:20 PM',
      fromMe: false
    })

    expect(msg.ts).not.toBe('NaN')
    expect(isNaN(Number(msg.ts))).toBe(false)
    expect(msg.user).toBe('Talent Killer')
    expect(msg.text).toBe('Hello world')
    expect(msg.source).toBe('client')
  })

  it('correctly parses Microsoft Teams relative and 2-digit timestamps without corruption', () => {
    const ts2Digit = parseTeamsTimestamp('13/11/26 14:30')
    expect(ts2Digit).not.toBe('NaN')
    const date2Digit = new Date(Number(ts2Digit) * 1000)
    expect(date2Digit.getFullYear()).toBe(2026)
    expect(date2Digit.getMonth()).toBe(10)
    expect(date2Digit.getDate()).toBe(13)

    const tsYesterday = parseTeamsTimestamp('Yesterday at 15:45')
    expect(tsYesterday).not.toBe('NaN')
    const dateY = new Date(Number(tsYesterday) * 1000)
    expect(dateY.getHours()).toBe(15)
    expect(dateY.getMinutes()).toBe(45)
  })
})
