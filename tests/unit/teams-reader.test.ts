import { describe, expect, it, vi } from 'vitest'
import { normalizeTeamsMessage } from '../../src/main/teams-reader/teams-normalizer'
import { TeamsReaderView, buildTeamsDirectReadScript } from '../../src/main/teams-reader/teams-reader-view'

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

  it('reads messages directly from IndexedDB replychain-manager via direct script', async () => {
    const directScript = buildTeamsDirectReadScript('teams_chat_unknown_knp', 'unknown knp')
    expect(directScript).toContain('indexedDB')
    expect(directScript).toContain('replychain')

    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('indexedDB') || script.includes('replychain')) {
          return [
            {
              id: '4153168011074496769',
              channelId: 'teams_chat_unknown_knp',
              senderName: 'unknown knp',
              text: '<p>are you ready ?</p>',
              timestamp: '2026-11-13T18:56:48.170Z'
            }
          ]
        }
        return []
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const messages = await reader.readMessages('teams_chat_unknown_knp', 'unknown knp')
    expect(messages.length).toBe(1)
    expect(messages[0].user).toBe('unknown knp')
    expect(messages[0].text).toBe('are you ready ?')
  })

  it('selects channel and posts message', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('cleared') || script.includes('composer_missing')) {
          return { ok: true, cleared: true }
        }
        if (script.includes('team-channel-item') || script.includes('chat-header-title')) return true
        if (script.includes('insertText') || script.includes('contenteditable')) {
          return { ok: true, hasText: true }
        }
        if (script.includes('sendMessageButton') || script.includes('candidates')) {
          return true
        }
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

  it('fails postMessage when composer is absent and does not report false positive cleared', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('cleared') || script.includes('composer_missing')) {
          return { ok: false, cleared: false, error: 'composer_missing' }
        }
        if (script.includes('team-channel-item') || script.includes('chat-header-title')) return true
        if (script.includes('insertText') || script.includes('contenteditable')) {
          return { ok: false, error: 'composer_not_found' }
        }
        return false
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const posted = await reader.postMessage('ch-1', 'Test message')
    expect(posted).toBe(false)
  })

  it('rejects postMessage when composer is not cleared or missing during verification', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('cleared') || script.includes('composer_missing')) {
          return { ok: false, cleared: false, error: 'not_cleared' }
        }
        if (script.includes('team-channel-item') || script.includes('chat-header-title')) return true
        if (script.includes('insertText') || script.includes('contenteditable')) {
          return { ok: true, hasText: true }
        }
        if (script.includes('sendMessageButton') || script.includes('candidates')) {
          return false
        }
        return false
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new TeamsReaderView({
      profileId: 'prof-1',
      existingView: mockWebContents ? mockView : null
    })

    const posted = await reader.postMessage('ch-1', 'Message not sent')
    expect(posted).toBe(false)
  })
})
