import { describe, expect, it, vi } from 'vitest'
import { normalizeWhatsAppMessage } from '../../src/main/whatsapp-reader/whatsapp-normalizer'
import { WhatsAppReaderView } from '../../src/main/whatsapp-reader/whatsapp-reader-view'

describe('WhatsApp Normalizer', () => {
  it('normalizes incoming WhatsApp message into standard DashboardStoredMessage', () => {
    const raw = {
      id: 'wa-msg-1',
      chatId: '12345@c.us',
      senderId: 'contact-bob',
      senderName: 'Bob Miller',
      text: 'Hey are you available for a quick sync?',
      timestamp: 1731456200000,
      fromMe: false
    }

    const normalized = normalizeWhatsAppMessage(raw, '12345@c.us')

    expect(normalized.ts).toBe('1731456200.000000')
    expect(normalized.user).toBe('Bob Miller')
    expect(normalized.text).toBe('Hey are you available for a quick sync?')
    expect(normalized.source).toBe('client')
  })

  it('marks outbound message as source: ours and user: You', () => {
    const raw = {
      id: 'wa-msg-2',
      chatId: '12345@c.us',
      text: 'Yes, hopping on now!',
      timestamp: 1731456250000,
      fromMe: true
    }

    const normalized = normalizeWhatsAppMessage(raw, '12345@c.us')
    expect(normalized.user).toBe('You')
    expect(normalized.source).toBe('ours')
  })
})

describe('WhatsAppReaderView', () => {
  it('lists chats and contacts using evaluated script in WebContentsView', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        { id: 'chat-alice', name: 'Alice Direct', isPrivate: true, kind: 'dm' },
        { id: 'group-dev', name: 'Dev Team Group', isPrivate: true, kind: 'group-dm', unreadCount: 3 }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const chats = await reader.listChats()
    expect(chats.length).toBe(2)
    expect(chats[0].name).toBe('Alice Direct')
    expect(chats[0].kind).toBe('dm')
    expect(chats[1].name).toBe('Dev Team Group')
    expect(chats[1].kind).toBe('group-dm')
    expect(chats[1].unreadCount).toBe(3)
  })

  it('filters out 0-message chats and empty contacts', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        { id: 'chat-active', name: 'Active Client', isPrivate: true, kind: 'dm', messageCount: 5, hasMessages: true },
        { id: 'chat-empty', name: 'Empty Contact', isPrivate: true, kind: 'dm', messageCount: 0, hasMessages: false }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const chats = await reader.listChats()
    expect(chats.length).toBe(1)
    expect(chats[0].name).toBe('Active Client')
    expect(chats[0].messageCount).toBe(5)
  })

  it('reads messages using evaluated script in WebContentsView', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockResolvedValue([
        {
          id: 'w1',
          senderName: 'Charlie',
          text: 'Project update ready',
          timestamp: 1731456300000,
          fromMe: false
        }
      ])
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const messages = await reader.readMessages('chat-charlie')
    expect(messages.length).toBe(1)
    expect(messages[0].user).toBe('Charlie')
    expect(messages[0].text).toBe('Project update ready')
  })

  it('selects chat and posts message', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('openChatAt')) return true
        if (script.includes('conversation-compose-box-input')) return true
        return true
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const selected = await reader.selectChat('chat-alice')
    expect(selected).toBe(true)

    const posted = await reader.postMessage('chat-alice', 'Hello on WhatsApp!')
    expect(posted).toBe(true)
  })

  it('falls back to search box when contact is not in top pane-side list', async () => {
    const executedScripts: string[] = []
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        executedScripts.push(script)
        // First attempt (pane-side DOM) returns false
        if (script.includes('openChatAt') && script.includes('pane-side')) {
          return false
        }
        // Search input initialization succeeds
        if (script.includes('chat-list-search') || script.includes('data-tab="3"')) {
          return true
        }
        // Second attempt after search results renders finds contact
        if (script.includes('cancel-search')) {
          return true
        }
        return false
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      projectId: 'proj-123',
      existingView: mockView
    })

    const selected = await reader.selectChat('wa_talent_killer___', 'Talent Killer')
    expect(selected).toBe(true)
    expect(executedScripts.some((s) => s.includes('chat-list-search') || s.includes('data-tab="3"'))).toBe(true)
  })

  it('strictly returns empty array when #main header does not match target contact (prevents cross-chat contamination)', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        // When checking active chat title, simulate a different chat open in #main
        if (script.includes('#main header')) {
          return 'Someone Else Entirely'
        }
        // Even if messages exist in #main
        return [
          {
            id: 'foreign-msg',
            senderName: 'Someone Else',
            text: 'Foreign text from another chat',
            timestamp: 1731456300000,
            fromMe: false
          }
        ]
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const messages = await reader.readMessages('wa_the_creator', 'The Creator')
    // Must return empty array so that "Someone Else Entirely" messages are NEVER written into The Creator's delta file!
    expect(messages).toEqual([])
  })

  it('reads messages when #main header matches target contact', async () => {
    const mockWebContents = {
      isDestroyed: vi.fn().mockReturnValue(false),
      executeJavaScript: vi.fn().mockImplementation(async (script: string) => {
        if (script.includes('if (!header) return null')) {
          return 'The Creator'
        }
        if (script.includes('selectable-text') || script.includes('copyable-text')) {
          return [
            {
              id: 'creator-msg-1',
              senderName: 'The Creator',
              text: 'Hello, this is authentic Creator message',
              timestamp: 1731456300000,
              fromMe: false
            }
          ]
        }
        return []
      })
    }
    const mockView = { webContents: mockWebContents } as any

    const reader = new WhatsAppReaderView({
      profileId: 'prof-1',
      existingView: mockView
    })

    const messages = await reader.readMessages('wa_the_creator', 'The Creator')
    expect(messages.length).toBe(1)
    expect(messages[0].user).toBe('The Creator')
    expect(messages[0].text).toBe('Hello, this is authentic Creator message')
  })

  it('matchesTarget correctly handles emojis, case insensitivity, and rejects empty strings', () => {
    const reader = new WhatsAppReaderView({ profileId: 'prof-1' })

    // Exact and slug matches
    expect(reader.matchesTarget('The Creator', 'wa_the_creator', 'The Creator')).toBe(true)
    expect(reader.matchesTarget('Talent Killer 👿', 'wa_talent_killer___', 'Talent Killer 👿')).toBe(true)
    expect(reader.matchesTarget('Talent Killer', 'wa_talent_killer___', 'Talent Killer 👿')).toBe(true)

    // Mismatches
    expect(reader.matchesTarget('Completely Different Chat', 'wa_the_creator', 'The Creator')).toBe(false)
    expect(reader.matchesTarget('BotFather', 'wa_talent_killer___', 'Talent Killer 👿')).toBe(false)
    expect(reader.matchesTarget('', 'wa_the_creator', 'The Creator')).toBe(false)
  })
})
