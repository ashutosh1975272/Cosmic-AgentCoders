import { describe, expect, it } from 'vitest'
import {
  cleanMessageText,
  deduplicateMessages,
  normalizeSlackTimestamp,
  normalizeScrapedMessage,
  type RawScrapedMessage
} from '../../src/main/slack-reader/normalizer'
import { SLACK_SELECTORS } from '../../src/main/slack-reader/slack-selectors'

describe('Slack Reader Core (SLK-2)', () => {
  describe('Selectors Integrity', () => {
    it('defines non-empty data-qa selectors for all critical slack components', () => {
      expect(SLACK_SELECTORS.loggedInIndicator).toBeTruthy()
      expect(SLACK_SELECTORS.channelListContainer).toBeTruthy()
      expect(SLACK_SELECTORS.channelItem).toBeTruthy()
      expect(SLACK_SELECTORS.channelName).toBeTruthy()
      expect(SLACK_SELECTORS.messageRow).toBeTruthy()
      expect(SLACK_SELECTORS.messageBody).toBeTruthy()
      expect(SLACK_SELECTORS.messageTimestamp).toBeTruthy()
    })
  })

  describe('Timestamp Normalization', () => {
    it('normalizes slack decimal string timestamps', () => {
      expect(normalizeSlackTimestamp('1730000000.123456')).toBe('1730000000.123456')
      expect(normalizeSlackTimestamp('1730000000')).toBe('1730000000.000000')
    })

    it('normalizes epoch milliseconds number or string', () => {
      const ms = 1730000000000
      expect(normalizeSlackTimestamp(ms)).toBe('1730000000.000000')
      expect(normalizeSlackTimestamp('1730000000000')).toBe('1730000000.000000')
    })

    it('normalizes archive permalink timestamp format (p1730000000123456)', () => {
      expect(normalizeSlackTimestamp('p1730000000123456')).toBe('1730000000.123456')
      expect(normalizeSlackTimestamp('1730000000123456')).toBe('1730000000.123456')
    })

    it('returns null when timestamp is missing or empty (avoids fabricating fake time)', () => {
      expect(normalizeSlackTimestamp('')).toBeNull()
      expect(normalizeSlackTimestamp('invalid')).toBeNull()
      expect(normalizeSlackTimestamp(undefined)).toBeNull()
    })
  })

  describe('Message Text Cleaning', () => {
    it('strips zero-width chars and normalizes whitespace', () => {
      const raw = 'Hello \u200Bworld!\r\nHow\uFEFF are   you?'
      expect(cleanMessageText(raw)).toBe('Hello world!\nHow are you?')
    })
  })

  describe('Message Normalization & Deduplication', () => {
    it('normalizes raw scraped message into DashboardStoredMessage', () => {
      const raw: RawScrapedMessage = {
        rawTs: '1730000000.123456',
        sender: 'Atul Kumar',
        text: 'Deploy completed successfully.',
        permalink: 'https://acme.slack.com/archives/C123/p1730000000123456'
      }

      const msg = normalizeScrapedMessage(raw, 'C123')
      expect(msg).not.toBeNull()
      expect(msg!.ts).toBe('1730000000.123456')
      expect(msg!.user).toBe('Atul Kumar')
      expect(msg!.text).toBe('Deploy completed successfully.')
      expect(msg!.source).toBe('client')
      expect(msg!.permalink).toBe('https://acme.slack.com/archives/C123/p1730000000123456')
    })

    it('skips message if timestamp cannot be extracted from DOM', () => {
      const raw: RawScrapedMessage = {
        rawTs: '',
        sender: 'Atul',
        text: 'No timestamp message'
      }
      expect(normalizeScrapedMessage(raw, 'C123')).toBeNull()
    })

    it('deduplicates identical messages based on workspaceId, channelId and ts', () => {
      const m1 = { ts: '1730000000.000001', user: 'Alice', text: 'Hi', source: 'client' as const }
      const m2 = { ts: '1730000000.000001', user: 'Alice', text: 'Hi duplicate', source: 'client' as const }
      const m3 = { ts: '1730000000.000002', user: 'Bob', text: 'Hey', source: 'client' as const }

      const deduped = deduplicateMessages('T_WORKSPACE', 'C_GENERAL', [m1, m2, m3])
      expect(deduped).toHaveLength(2)
      expect(deduped[0]!.ts).toBe('1730000000.000001')
      expect(deduped[1]!.ts).toBe('1730000000.000002')
    })
  })
})
