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
})
