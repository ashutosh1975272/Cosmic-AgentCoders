import { WebContentsView, session } from 'electron'
import { partitionForProfile, partitionForCard } from '../profiles/session-partition'
import { normalizeTeamsMessage, type RawTeamsMessage } from './teams-normalizer'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface TeamsDiscoveredChannel {
  id: string
  name: string
  isPrivate: boolean
  isDm: boolean
  kind: 'public' | 'private' | 'dm'
  memberCount?: number
  lastActivity?: string
  messageCount?: number
  hasMessages?: boolean
}

export interface TeamsReaderOptions {
  profileId: string
  projectId?: string
  existingView?: WebContentsView | null
}

const TEAMS_DISCOVER_CHANNELS_SCRIPT = `
(() => {
  try {
    const results = [];
    const seen = new Set();
    const systemWords = new Set([
      'chat', 'teams', 'activity', 'calendar', 'calls', 'onedrive', 'apps',
      'invite to teams', 'sync device contacts', 'all contacts', 'active now',
      'favorites', 'chats', 'unread', 'meeting chats', 'unmuted', 'settings'
    ]);

    const sanitizeContactName = (raw) => {
      if (!raw) return '';
      let s = String(raw).trim();
      // Remove accordion / section prefixes
      s = s.replace(/^(?:Favorites|Chats|Recent|Pinned|Direct Messages)\s*/i, '');
      // Remove trailing timestamps like "12:26 AM", "1:26 PM", "7:14 PM", "11/13", "Yesterday"
      s = s.replace(/\s*\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b.*$/i, '');
      s = s.replace(/\s*\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.*$/i, '');
      s = s.replace(/\s*\b(?:yesterday|today)\b.*$/i, '');
      // Remove "(You)" self tag
      s = s.replace(/\s*\(You\)\s*/gi, ' ');
      // Remove preview snippets like "You: are you ready ?", "Ashutosh: ...", "unknown knp: ..."
      s = s.replace(/\s*(?:You|Me|[a-zA-Z0-9_\s]+):\s*.*$/i, '');
      return s.trim();
    };

    // 1. Query Teams channel list items (Teams workspace public/private channels)
    const channelNodes = document.querySelectorAll(
      '[data-tid="team-channel-item"], [data-tid="channel-list-item"], [data-tid="channel-name"]'
    );
    channelNodes.forEach((node) => {
      const rawText = (node.textContent || '').trim().split('\\n')[0].trim();
      const cleanName = sanitizeContactName(rawText);
      const lower = cleanName.toLowerCase();
      if (cleanName && !seen.has(lower) && !systemWords.has(lower)) {
        seen.add(lower);
        const id = node.getAttribute('data-tid') || node.getAttribute('id') || ('teams_ch_' + cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'));
        results.push({
          id,
          name: cleanName,
          isPrivate: node.querySelector('[data-icon-name="Lock"]') !== null,
          isDm: false,
          kind: 'public'
        });
      }
    });

    // 2. Query Direct Chats, Personal Chats, and Meeting Chats
    const chatNodes = document.querySelectorAll(
      '[data-tid="chat-list-item"], [data-tid="chat-item"], [data-tid="contact-list-item"], [role="listitem"]'
    );
    chatNodes.forEach((node) => {
      // Exclude accordion section headers
      if (node.getAttribute('role') === 'treeitem' && node.querySelector('[role="treeitem"], [role="listitem"]')) {
        return;
      }
      const titleEl = node.querySelector(
        '[data-tid="chat-list-item-title"], [data-tid="chat-title"], [data-tid="channel-name"], [data-tid="thread-title"], .ui-chat__item__title, span[data-tid*="title"]'
      );
      const rawName = titleEl
        ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim()
        : (node.textContent || '').trim().split('\\n')[0].trim();
      
      const cleanName = sanitizeContactName(rawName);
      const lower = cleanName.toLowerCase();
      if (!cleanName || cleanName.length < 2 || seen.has(lower) || systemWords.has(lower)) return;

      const previewEl = node.querySelector(
        '[data-tid="chat-list-item-preview"], [data-tid="chat-preview"], [data-tid="last-message"], [data-tid="chat-list-item-body"], .ui-chat__message__body'
      );
      const timeEl = node.querySelector(
        '[data-tid="chat-list-item-timestamp"], [data-tid="timestamp"], time, [data-tid="chat-list-item-time"]'
      );
      const previewText = (previewEl?.textContent || '').trim().toLowerCase();
      const isDraftOrEmpty =
        previewText.includes('this is your space') ||
        previewText.includes('draft messages, list your to-dos') ||
        previewText.includes('draft:');

      const unreadBadge = node.querySelector('[data-tid="chat-list-item-unread"], [aria-label*="unread"]');
      const unreadCount = unreadBadge ? parseInt(unreadBadge.textContent || '0', 10) || 0 : 0;

      // Exclude empty personal spaces and chats with 0 messages
      if ((!previewEl && !timeEl && unreadCount === 0) || (isDraftOrEmpty && unreadCount === 0)) {
        return;
      }

      seen.add(lower);
      const id = 'teams_chat_' + cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      results.push({
        id,
        name: cleanName,
        isPrivate: true,
        isDm: true,
        kind: 'dm',
        messageCount: unreadCount > 0 ? unreadCount : 1,
        hasMessages: true
      });
    });

    // 3. If list virtualized or empty, check active conversation header
    const headerTitleEl = document.querySelector(
      '[data-tid="chat-header-title"], [data-tid="channel-header-title"], [data-tid="header-title"], header h1, header h2, header [role="heading"]'
    );
    if (headerTitleEl) {
      const rawActive = (headerTitleEl.textContent || '').trim();
      const cleanName = sanitizeContactName(rawActive);
      const lower = cleanName.toLowerCase();
      if (cleanName && cleanName.length >= 2 && !seen.has(lower) && !systemWords.has(lower)) {
        const msgNodes = document.querySelectorAll(
          '[data-tid="message-pane-list-viewport"] [role="listitem"], [data-tid="chat-pane-item"], div[data-tid*="chat-message"], .ui-chat__message'
        );
        if (msgNodes.length > 0) {
          seen.add(lower);
          results.push({
            id: 'teams_chat_' + cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
            name: cleanName,
            isPrivate: true,
            isDm: true,
            kind: 'dm',
            messageCount: msgNodes.length,
            hasMessages: true
          });
        }
      }
    }

    return results;
  } catch (err) {
    return [];
  }
})()
`

const TEAMS_READ_MESSAGES_SCRIPT = `
(() => {
  try {
    const messages = [];
    const headerEl = document.querySelector(
      '[data-tid="chat-header-title"], [data-tid="channel-header-title"], header h1, header h2'
    );
    const rawHeader = headerEl ? (headerEl.textContent || '').trim() : '';
    const activeChatName = rawHeader
      .replace(/\\s*\\(You\\)$/i, '')
      .replace(/^(?:Favorites|Chats)\\s*/i, '')
      .trim() || 'Teams Member';

    const messageNodes = document.querySelectorAll(
      '[data-tid="message-pane-list-viewport"] [role="listitem"], [data-tid="chat-pane-item"], div[data-tid*="chat-message"], .ui-chat__message, div[role="listitem"] div[data-tid="message-body"]'
    );

    let lastKnownTimestamp = '';

    messageNodes.forEach((node, idx) => {
      const container = node.closest('[role="listitem"]') || node;
      const senderEl = container.querySelector('[data-tid="message-author-name"], [data-tid="message-author"], .ui-chat__message__author, span[data-tid="author"]');
      const bodyEl = container.querySelector('[data-tid="message-body"], .ui-chat__message__content, [data-tid="chat-message-text"], p');
      const timeEl = container.querySelector('time, [data-tid="message-timestamp"]');

      let senderName = senderEl ? (senderEl.textContent || '').trim().replace(/\\s*\\(You\\)$/i, '') : '';
      if (!senderName) {
        // Detect if this is an outgoing message (You)
        const isOutgoing = container.classList.contains('ui-chat__message--mine') ||
          container.querySelector('[data-tid="chat-message-mine"]') !== null ||
          container.getAttribute('data-is-mine') === 'true';
        senderName = isOutgoing ? 'You' : activeChatName;
      }

      const text = bodyEl ? (bodyEl.innerHTML || bodyEl.textContent || '').trim() : '';

      // Extract time from container time element, parent date header, or tooltip
      let timestamp = '';
      if (timeEl) {
        timestamp = timeEl.getAttribute('datetime') || (timeEl.textContent || '').trim();
      }
      if (!timestamp) {
        const ariaLabel = container.getAttribute('aria-label') || '';
        const mTime = ariaLabel.match(/\\b(?:sent at|at)\\s+([0-9:AMPMapm\\s\\/\\-]+)/i);
        if (mTime) {
          timestamp = mTime[1].trim();
        }
      }
      if (!timestamp) {
        // Check previous day/time header in viewport
        const prevHeader = container.previousElementSibling?.querySelector('[role="heading"], time');
        if (prevHeader) {
          timestamp = (prevHeader.textContent || '').trim();
        }
      }
      if (timestamp) {
        lastKnownTimestamp = timestamp;
      } else if (lastKnownTimestamp) {
        timestamp = lastKnownTimestamp;
      } else {
        // Generate stable deterministic timestamp based on sender + text + idx to prevent flapping
        let hash = 0;
        const s = senderName + '|' + text;
        for (let i = 0; i < s.length; i++) {
          hash = ((hash << 5) - hash) + s.charCodeAt(i);
          hash |= 0;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const baseSec = Math.floor(today.getTime() / 1000);
        timestamp = String(baseSec + Math.abs(hash % 86400)) + '.' + String(idx).padStart(6, '0');
      }

      if (text) {
        messages.push({
          id: 'teams_msg_' + idx + '_' + Math.abs(hashString(text + senderName)),
          channelId: 'active_channel',
          senderId: senderName.toLowerCase().replace(/\\s+/g, '_'),
          senderName,
          text,
          timestamp
        });
      }
    });

    function hashString(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
      }
      return h;
    }

    return messages;
  } catch (err) {
    return [];
  }
})()
`

export class TeamsReaderView {
  private view: WebContentsView | null = null
  private ownsView = false
  private readonly profileId: string
  private readonly projectId?: string

  constructor(options: TeamsReaderOptions) {
    this.profileId = options.profileId
    this.projectId = options.projectId
    if (options.existingView) {
      this.view = options.existingView
      this.ownsView = false
    }
  }

  async initialize(): Promise<void> {
    if (this.view) return
    const partition = this.projectId
      ? partitionForCard(this.projectId, 'teams')
      : partitionForProfile(this.profileId, 'teams')
    const sess = session.fromPartition(partition)
    this.view = new WebContentsView({
      webPreferences: {
        session: sess,
        sandbox: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    this.view.setBounds({ x: -10000, y: -10000, width: 1280, height: 900 })
    this.ownsView = true
  }

  getView(): WebContentsView | null {
    return this.view
  }

  async listChannels(): Promise<TeamsDiscoveredChannel[]> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return []
    }
    try {
      const raw = await this.view.webContents.executeJavaScript(
        TEAMS_DISCOVER_CHANNELS_SCRIPT,
        true
      )
      if (Array.isArray(raw)) {
        return raw
          .filter(
            (item) =>
              item &&
              item.hasMessages !== false &&
              (item.messageCount === undefined || item.messageCount >= 1)
          )
          .map((item) => ({
            id: String(item.id || item.name),
            name: String(item.name),
            isPrivate: Boolean(item.isPrivate),
            isDm: Boolean(item.isDm),
            kind: item.isDm ? 'dm' : item.isPrivate ? 'private' : 'public',
            memberCount: item.memberCount,
            messageCount: item.messageCount ?? (item.hasMessages ? 1 : undefined),
            hasMessages: item.hasMessages ?? true
          }))
      }
      return []
    } catch {
      return []
    }
  }

  async readMessages(channelId: string): Promise<DashboardStoredMessage[]> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return []
    }
    try {
      const raw = await this.view.webContents.executeJavaScript(
        TEAMS_READ_MESSAGES_SCRIPT,
        true
      )
      if (Array.isArray(raw)) {
        return raw.map((m: RawTeamsMessage) => normalizeTeamsMessage(m, channelId))
      }
      return []
    } catch {
      return []
    }
  }

  async selectChannel(channelId: string): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return false
    }
    try {
      const script = `
        (() => {
          try {
            const rawTarget = ${JSON.stringify(channelId)};
            const cleanTarget = rawTarget
              .replace(/^teams_chat_/i, '')
              .replace(/^teams_ch_/i, '')
              .replace(/_/g, ' ')
              .trim()
              .toLowerCase();
            const target = rawTarget.toLowerCase().trim();

            const nodes = document.querySelectorAll(
              '[data-tid="team-channel-item"], [data-tid="channel-list-item"], [data-tid="chat-list-item"], [data-tid="chat-item"], [data-tid="contact-list-item"], [role="treeitem"], [role="listitem"]'
            );
            for (const node of nodes) {
              const tid = (node.getAttribute('data-tid') || '').toLowerCase();
              const id = (node.getAttribute('id') || '').toLowerCase();
              const titleEl = node.querySelector('[data-tid*="title"], span[title], span[dir="auto"], h2, h3, p');
              const titleText = (titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : '').toLowerCase().trim();
              const text = (node.textContent || '').toLowerCase().trim();

              if (
                tid === target ||
                id === target ||
                (cleanTarget && titleText.includes(cleanTarget)) ||
                (cleanTarget && text.includes(cleanTarget))
              ) {
                const clickable = node.querySelector('button, a, div[role="button"]') || node;
                clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                clickable.click();
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
        // Allow brief DOM hydration for message container
        await new Promise((r) => setTimeout(r, 600))
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async postMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return false
    }
    try {
      // 1. Ensure target chat is focused/selected first
      if (channelId && channelId !== 'active_channel') {
        await this.selectChannel(channelId)
      }

      const script = `
        (() => {
          try {
            const msg = ${JSON.stringify(text)};
            // Match Teams V2 Fluent UI, RoosterJS, Lexical, and fallback contenteditable composers
            const box = document.querySelector(
              '[data-tid="new-message-textarea"], div[aria-label="Type a message"], div[aria-label*="Type a message"], [data-tid="ckeditor-replyConversation"], [role="textbox"][contenteditable="true"], .ck-editor__editable, textarea'
            );
            if (!box) return { ok: false, error: 'composer_not_found' };

            box.focus();

            if (box.isContentEditable) {
              document.execCommand('selectAll', false, null);
              const inserted = document.execCommand('insertText', false, msg);
              if (!inserted || !box.textContent.trim()) {
                box.textContent = msg;
              }
              box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: msg }));
              box.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              box.value = msg;
              box.dispatchEvent(new Event('input', { bubbles: true }));
              box.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Locate Teams V2 send button
            const sendBtn = document.querySelector(
              '[data-tid="sendMessageButton"], [data-tid="chat-send-message-button"], button[data-tid="sendButton"], button[aria-label*="Send message"], button[aria-label*="Send"], button[title*="Send"]'
            );

            if (sendBtn && !sendBtn.disabled) {
              sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              sendBtn.click();
              return { ok: true, method: 'button_click' };
            }

            // Fallback: Dispatch Enter key event to submit message
            const enterDown = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            });
            const enterUp = new KeyboardEvent('keyup', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            });
            box.dispatchEvent(enterDown);
            box.dispatchEvent(enterUp);
            return { ok: true, method: 'enter_key' };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        })()
      `
      const res = await this.view.webContents.executeJavaScript(script, true)
      if (res === true || (res && res.ok)) {
        await new Promise((r) => setTimeout(r, 600))
        return true
      }
      return false
    } catch {
      return false
    }
  }

  dispose(): void {
    if (this.ownsView && this.view && !this.view.webContents.isDestroyed()) {
      // Allow garbage collector to clean up
      this.view = null
    }
  }
}
