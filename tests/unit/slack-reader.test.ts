import { describe, expect, it } from 'vitest'
import {
  cleanMessageText,
  deduplicateMessages,
  normalizeSlackTimestamp,
  normalizeScrapedMessage,
  type RawScrapedMessage
} from '../../src/main/slack-reader/normalizer'
import { SLACK_SELECTORS } from '../../src/main/slack-reader/slack-selectors'
import { __test__ as slackApiInternal } from '../../src/main/slack/slack-api-client'
import { LIST_CHANNELS_SCRIPT } from '../../src/main/slack-reader/slack-adapter'

describe('Slack Reader Core (SLK-2)', () => {
  describe('Channel Discovery & Metadata Extraction (Two-Phase Scraping)', () => {
    it('toChannelSummary extracts created epoch and memberCount from Slack API', () => {
      const summary = slackApiInternal.toChannelSummary({
        id: 'C0CCSJXS7SS',
        name: 'aaa',
        is_private: false,
        created: 1761644400, // Oct 28 2026
        num_members: 4,
        topic: { value: 'Project kickoff' }
      })

      expect(summary.id).toBe('C0CCSJXS7SS')
      expect(summary.name).toBe('aaa')
      expect(summary.isPrivate).toBe(false)
      expect(summary.created).toBe(1761644400)
      expect(summary.memberCount).toBe(4)
      expect(summary.topic).toBe('Project kickoff')
    })

    it('LIST_CHANNELS_SCRIPT includes regex for member count and fallback checks for window models', () => {
      expect(LIST_CHANNELS_SCRIPT).toContain('members?')
      expect(LIST_CHANNELS_SCRIPT).toContain('window.boot_data')
      expect(LIST_CHANNELS_SCRIPT).toContain('window.TS')
      expect(LIST_CHANNELS_SCRIPT).toContain('created')
      expect(LIST_CHANNELS_SCRIPT).toContain('memberCount')
    })

    it('historical scraping window logic: 30-day fixed horizon on initial or forced 30-day vs genesis vs incremental delta', () => {
      const nowSec = 1762100882
      const thirtyDaysAgo = nowSec - 30 * 86400

      // Case 1: First scrape with no cursor -> 30-day horizon
      const cursor1 = null
      const isGenesis1 = false
      const isThirtyDays1 = !cursor1
      const sinceTs1 = isGenesis1 ? 0 : isThirtyDays1 ? thirtyDaysAgo : (cursor1 ?? 0) - 120
      expect(sinceTs1).toBe(thirtyDaysAgo)

      // Case 2: Explicit forceGenesis -> 0 (genesis inception)
      const cursor2 = 1762100000
      const isGenesis2 = true
      const isThirtyDays2 = !cursor2
      const sinceTs2 = isGenesis2 ? 0 : isThirtyDays2 ? thirtyDaysAgo : cursor2 - 120
      expect(sinceTs2).toBe(0)

      // Case 3: Explicit force30Days -> 30 days ago
      const cursor3 = 1762100000
      const isGenesis3 = false
      const isThirtyDays3 = true
      const sinceTs3 = isGenesis3 ? 0 : isThirtyDays3 ? thirtyDaysAgo : cursor3 - 120
      expect(sinceTs3).toBe(thirtyDaysAgo)

      // Case 4: Subsequent automated scrape with cursor -> incremental fast-forward (cursor - 120s)
      const cursor4 = 1762100000
      const isGenesis4 = false
      const isThirtyDays4 = false
      const sinceTs4 = isGenesis4 ? 0 : isThirtyDays4 ? thirtyDaysAgo : cursor4 - 120
      expect(sinceTs4).toBe(1762099880)

      // Case 5: Custom lookback horizon (e.g. 230 days)
      const requestedDays: number = 230
      const isGenesis5 = requestedDays === 0
      const isCustom5 = typeof requestedDays === 'number' && requestedDays > 0
      const sinceTs5 = isGenesis5 ? 0 : isCustom5 ? nowSec - requestedDays * 86400 : thirtyDaysAgo
      expect(sinceTs5).toBe(nowSec - 230 * 86400)
    })
  })
  describe('Selectors Integrity', () => {
    it('defines non-empty data-qa selectors for all critical slack components', () => {
      expect(SLACK_SELECTORS.loggedInIndicator).toBeTruthy()
      expect(SLACK_SELECTORS.channelListContainer).toBeTruthy()
      expect(SLACK_SELECTORS.channelItem).toBeTruthy()
      expect(SLACK_SELECTORS.channelName).toBeTruthy()
      expect(SLACK_SELECTORS.messageRow).toBeTruthy()
      expect(SLACK_SELECTORS.messageBody).toBeTruthy()
      expect(SLACK_SELECTORS.messageTimestamp).toBeTruthy()
      expect(SLACK_SELECTORS.threadReplyButton).toBeTruthy()
      expect(SLACK_SELECTORS.threadContainer).toBeTruthy()
      expect(SLACK_SELECTORS.threadMessageRow).toBeTruthy()
      expect(SLACK_SELECTORS.threadCloseButton).toBeTruthy()
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

    it('preserves threadTs and replyCount when normalizing thread parents or replies', () => {
      const parentRaw: RawScrapedMessage = {
        rawTs: '1730000000.100000',
        sender: 'Alice',
        text: 'Initial query',
        replyCount: 5
      }
      const parent = normalizeScrapedMessage(parentRaw, 'C123')
      expect(parent?.replyCount).toBe(5)
      expect(parent?.threadTs).toBeUndefined()

      const replyRaw: RawScrapedMessage = {
        rawTs: '1730000000.200000',
        sender: 'Bob',
        text: 'Thread resolution',
        threadTs: '1730000000.100000'
      }
      const reply = normalizeScrapedMessage(replyRaw, 'C123')
      expect(reply?.threadTs).toBe('1730000000.100000')
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
