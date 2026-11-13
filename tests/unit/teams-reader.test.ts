import { describe, expect, it, vi } from 'vitest'
import { normalizeTeamsMessage } from '../../src/main/teams-reader/teams-normalizer'
import { TeamsReaderView } from '../../src/main/teams-reader/teams-reader-view'

describe('Teams Normalizer', () => {
  it('normalizes raw Teams message into standard DashboardStoredMessage', () => {
    const raw = {
      id: 'msg-1',
      channelId: 'teams-general',
      senderId: 'user-ashutosh',
      senderName: 'Ashutosh',
      text: '<p>Hello <at id="0">Team</at>! This is a test &amp; demo.</p>',
      timestamp: 1731456000000
    }

    const normalized = normalizeTeamsMessage(raw, 'teams-general')

    expect(normalized.ts).toBe('1731456000.000000')
    expect(normalized.user).toBe('Ashutosh')
    expect(normalized.text).toBe('Hello @Team! This is a test & demo.')
    expect(normalized.source).toBe('client')
  })

  it('handles string ISO timestamp and bot sender', () => {
    const raw = {
      id: 'msg-2',
      channelId: 'teams-general',
      text: 'Automated notification',
      timestamp: '2026-11-13T00:00:00.000Z',
      isBot: true
    }

    const normalized = normalizeTeamsMessage(raw, 'teams-general')
    expect(normalized.subtype).toBe('bot_message')
    expect(Number(normalized.ts)).toBeGreaterThan(0)
  })
})

describe('TeamsReaderView', () => {
  it('lists channels using evaluated script in WebContentsView', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        { id: 'ch-1', name: 'General', isPrivate: false, isDm: false },
        { id: 'chat-1', name: 'Ashutosh Jackson', isPrivate: true, isDm: true }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const channels = await reader.listChannels()
    expect(channels.length).toBe(2)
    expect(channels[0].name).toBe('General')
    expect(channels[0].kind).toBe('public')
    expect(channels[1].name).toBe('Ashutosh Jackson')
    expect(channels[1].kind).toBe('dm')
  })

  it('filters out 0-message channels and empty personal drafts', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        { id: 'teams_active', name: 'General', isPrivate: false, isDm: false, kind: 'public', messageCount: 12, hasMessages: true },
        { id: 'teams_empty_space', name: 'unknown knp (You)', isPrivate: true, isDm: true, kind: 'dm', messageCount: 0, hasMessages: false }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const channels = await reader.listChannels()
    expect(channels.length).toBe(1)
    expect(channels[0].name).toBe('General')
    expect(channels[0].messageCount).toBe(12)
  })

  it('reads messages from evaluated script in WebContentsView', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        {
          id: 'm1',
          senderName: 'Alice',
          text: 'Sprint review tomorrow',
          timestamp: 1731456100000
        }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const messages = await reader.readMessages('teams-general')
    expect(messages.length).toBe(1)
    expect(messages[0].user).toBe('Alice')
    expect(messages[0].text).toBe('Sprint review tomorrow')
  })

  it('selects channel and posts message', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('team-channel-item')) return true
        if (script.includes('ckeditor-replyConversation')) return true
        return true
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const selected = await reader.selectChannel('ch-1')
    expect(selected).toBe(true)

    const posted = await reader.postMessage('ch-1', 'Hello from Agent!')
    expect(posted).toBe(true)
  })
})
