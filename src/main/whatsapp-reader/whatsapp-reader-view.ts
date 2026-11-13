import { WebContentsView, session } from 'electron'
import { partitionForProfile } from '../profiles/session-partition'
import { normalizeWhatsAppMessage, type RawWhatsAppMessage } from './whatsapp-normalizer'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface WhatsAppDiscoveredChat {
  id: string
  name: string
  isPrivate: boolean
  isDm: boolean
  kind: 'dm' | 'group-dm'
  unreadCount?: number
  lastActivity?: string
}

export interface WhatsAppReaderOptions {
  profileId: string
  existingView?: WebContentsView | null
}

const WHATSAPP_DISCOVER_CHATS_SCRIPT = `
(() => {
  try {
    const results = [];
    const seen = new Set();

    // 1. Try WhatsApp Web internal store if available
    if (window.Store && window.Store.Chat && typeof window.Store.Chat.models === 'object') {
      try {
        const chats = window.Store.Chat.models;
        for (const c of chats) {
          const name = c.formattedTitle || c.name || c.__x_formattedTitle || '';
          const id = c.id?._serialized || c.id || name;
          const isGroup = Boolean(c.isGroup || c.__x_isGroup);
          if (name && !seen.has(name)) {
            seen.add(name);
            results.push({
              id,
              name,
              isPrivate: true,
              isDm: !isGroup,
              kind: isGroup ? 'group-dm' : 'dm',
              unreadCount: Number(c.unreadCount || 0)
            });
          }
        }
        if (results.length > 0) return results;
      } catch {
        // Fall back to DOM parsing
      }
    }

    // 2. Fallback to WhatsApp Web DOM query
    const chatItems = document.querySelectorAll(
      '#pane-side [role="listitem"], #pane-side div[tabindex="-1"], div[data-testid="cell-frame-container"]'
    );

    chatItems.forEach((node) => {
      const titleSpan = node.querySelector('span[title], div[title], [data-testid="cell-frame-title"] span');
      const name = titleSpan ? (titleSpan.getAttribute('title') || titleSpan.textContent || '').trim() : '';
      if (name && !seen.has(name)) {
        seen.add(name);
        const unreadBadge = node.querySelector('[data-testid="unread-count"], [aria-label*="unread"]');
        const unreadCount = unreadBadge ? parseInt(unreadBadge.textContent || '0', 10) || 0 : 0;
        const id = 'wa_' + name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        // If name has words like Group, Team, or has comma, flag as group
        const isGroup = name.toLowerCase().includes('group') || name.includes(',');
        results.push({
          id,
          name,
          isPrivate: true,
          isDm: !isGroup,
          kind: isGroup ? 'group-dm' : 'dm',
          unreadCount
        });
      }
    });

    // 3. Also query currently active chat header if present
    const headerTitleEl = document.querySelector(
      '#main header [data-testid="conversation-info-header-chat-title"], #main header span[title], #main header [role="heading"]'
    );
    if (headerTitleEl) {
      const name = (headerTitleEl.getAttribute('title') || headerTitleEl.textContent || '').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        const isGroup = name.toLowerCase().includes('group') || name.includes(',');
        results.push({
          id: 'wa_' + name.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
          name,
          isPrivate: true,
          isDm: !isGroup,
          kind: isGroup ? 'group-dm' : 'dm',
          unreadCount: 0
        });
      }
    }

    return results;
  } catch (err) {
    return [];
  }
})()
`

const WHATSAPP_READ_MESSAGES_SCRIPT = `
(() => {
  try {
    const messages = [];

    // 1. WhatsApp Web internal store
    if (window.Store && window.Store.Msg && typeof window.Store.Msg.models === 'object') {
      try {
        const msgs = window.Store.Msg.models.slice(-30);
        for (const m of msgs) {
          const text = m.body || m.__x_body || '';
          if (text) {
            messages.push({
              id: m.id?._serialized || String(m.id || Date.now()),
              chatId: m.chat?.id?._serialized || 'active_chat',
              senderId: m.fromMe ? 'me' : (m.sender?.id?._serialized || 'contact'),
              senderName: m.fromMe ? 'You' : (m.sender?.formattedTitle || m.sender?.name || 'Contact'),
              text,
              timestamp: (m.t || Date.now() / 1000) * 1000,
              fromMe: Boolean(m.fromMe)
            });
          }
        }
        if (messages.length > 0) return messages;
      } catch {
        // Fall back to DOM parsing
      }
    }

    // 2. Active chat header contact name
    const activeHeaderEl = document.querySelector(
      '#main header [data-testid="conversation-info-header-chat-title"], #main header span[title]'
    );
    const activeContactName = activeHeaderEl
      ? (activeHeaderEl.getAttribute('title') || activeHeaderEl.textContent || '').trim()
      : 'WhatsApp Contact';

    // 3. DOM extraction
    const msgNodes = document.querySelectorAll(
      '[data-testid="msg-container"], div.message-in, div.message-out, [role="row"]'
    );

    msgNodes.forEach((node, idx) => {
      const textEl = node.querySelector('.selectable-text, [data-testid="selectable-text"], span.copyable-text');
      const text = textEl ? (textEl.textContent || '').trim() : '';
      const isOut = node.classList.contains('message-out') || node.querySelector('[data-testid="tail-out"]') !== null;
      const copyableEl = node.querySelector('div.copyable-text[data-pre-plain-text]');
      const preText = copyableEl ? (copyableEl.getAttribute('data-pre-plain-text') || '') : '';

      let senderName = isOut ? 'You' : activeContactName;
      let timestamp = new Date().toISOString();

      if (preText) {
        // e.g. [12:30 PM, 11/13/2026] Ashutosh: 
        const authorMatch = preText.match(/\\]\\s*([^:]+):/);
        if (authorMatch && authorMatch[1]) {
          senderName = isOut ? 'You' : authorMatch[1].trim();
        }
        const timeMatch = preText.match(/\\[([^\\]]+)\\]/);
        if (timeMatch && timeMatch[1]) {
          timestamp = timeMatch[1].trim();
        }
      } else {
        const authorEl = node.querySelector('[data-testid="author"], div[data-testid="message-author"], span.color-1, span.color-2');
        if (authorEl && !isOut) {
          senderName = (authorEl.textContent || '').trim() || senderName;
        }
        const timeEl = node.querySelector('[data-testid="msg-meta"] span, span[dir="auto"]');
        if (timeEl) {
          timestamp = (timeEl.textContent || '').trim() || timestamp;
        }
      }

      if (text) {
        messages.push({
          id: 'wa_msg_' + idx + '_' + Date.now(),
          chatId: 'active_chat',
          senderId: senderName.toLowerCase().replace(/\\s+/g, '_'),
          senderName,
          text,
          timestamp,
          fromMe: isOut
        });
      }
    });

    return messages;
  } catch (err) {
    return [];
  }
})()
`

export class WhatsAppReaderView {
  private view: WebContentsView | null = null
  private ownsView = false
  private readonly profileId: string

  constructor(options: WhatsAppReaderOptions) {
    this.profileId = options.profileId
    if (options.existingView) {
      this.view = options.existingView
      this.ownsView = false
    }
  }

  async initialize(): Promise<void> {
    if (this.view) return
    const partition = partitionForProfile(this.profileId, 'whatsapp')
    const sess = session.fromPartition(partition)
    this.view = new WebContentsView({
      webPreferences: {
        session: sess,
        sandbox: false,
        contextIsolation: true
      }
    })
    this.ownsView = true
  }

  getView(): WebContentsView | null {
    return this.view
  }

  async listChats(): Promise<WhatsAppDiscoveredChat[]> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return []
    }
    try {
      const raw = await this.view.webContents.executeJavaScript(
        WHATSAPP_DISCOVER_CHATS_SCRIPT,
        true
      )
      if (Array.isArray(raw)) {
        return raw.map((item) => ({
          id: String(item.id || item.name),
          name: String(item.name),
          isPrivate: true,
          isDm: item.kind === 'dm',
          kind: item.kind === 'group-dm' || item.kind === 'group' ? 'group-dm' : 'dm',
          unreadCount: item.unreadCount || 0
        }))
      }
      return []
    } catch {
      return []
    }
  }

  async readMessages(chatId: string): Promise<DashboardStoredMessage[]> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return []
    }
    try {
      const raw = await this.view.webContents.executeJavaScript(
        WHATSAPP_READ_MESSAGES_SCRIPT,
        true
      )
      if (Array.isArray(raw)) {
        return raw.map((m: RawWhatsAppMessage) => normalizeWhatsAppMessage(m, chatId))
      }
      return []
    } catch {
      return []
    }
  }

  async selectChat(chatId: string): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return false
    }
    try {
      const script = `
        (() => {
          try {
            const target = ${JSON.stringify(chatId)}.toLowerCase().trim();
            // 1. Try Store.Cmd.openChatAt
            if (window.Store && window.Store.Cmd && window.Store.Chat && typeof window.Store.Chat.models === 'object') {
              for (const c of window.Store.Chat.models) {
                const sId = (c.id?._serialized || '').toLowerCase();
                const name = (c.formattedTitle || c.name || '').toLowerCase();
                if (sId === target || name === target || target.includes(name) || name.includes(target)) {
                  window.Store.Cmd.openChatAt(c);
                  return true;
                }
              }
            }

            // 2. DOM selection fallback
            const chatItems = document.querySelectorAll(
              '#pane-side [role="listitem"], #pane-side div[tabindex="-1"], div[data-testid="cell-frame-container"]'
            );
            for (const node of chatItems) {
              const titleSpan = node.querySelector('span[title], div[title], [data-testid="cell-frame-title"] span');
              const name = (titleSpan ? (titleSpan.getAttribute('title') || titleSpan.textContent || '') : '').toLowerCase().trim();
              if (name && (name === target || target.includes(name) || name.includes(target))) {
                node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                node.click();
                return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        })()
      `
      const clicked = await this.view.webContents.executeJavaScript(script, true)
      if (clicked) {
        await new Promise((r) => setTimeout(r, 600))
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async postMessage(_chatId: string, text: string): Promise<boolean> {
    void _chatId
    if (!this.view || this.view.webContents.isDestroyed()) {
      return false
    }
    try {
      const script = `
        (() => {
          try {
            const msg = ${JSON.stringify(text)};
            const box = document.querySelector(
              'footer [contenteditable="true"], [data-testid="conversation-compose-box-input"], footer div[role="textbox"]'
            );
            if (!box) return false;
            box.focus();
            document.execCommand('insertText', false, msg);
            box.dispatchEvent(new Event('input', { bubbles: true }));

            const sendBtn = document.querySelector(
              'button[data-testid="compose-btn-send"], span[data-icon="send"]'
            );
            if (sendBtn) {
              const clickable = sendBtn.closest('button') || sendBtn;
              clickable.click();
              return true;
            }
            return true;
          } catch {
            return false;
          }
        })()
      `
      return await this.view.webContents.executeJavaScript(script, true)
    } catch {
      return false
    }
  }

  dispose(): void {
    if (this.ownsView && this.view && !this.view.webContents.isDestroyed()) {
      this.view = null
    }
  }
}
