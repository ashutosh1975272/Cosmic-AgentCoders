import { WebContentsView, session } from 'electron'
import { partitionForProfile } from '../profiles/session-partition'
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
}

export interface TeamsReaderOptions {
  profileId: string
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

    // 1. Query Teams channel list items
    const channelNodes = document.querySelectorAll(
      '[data-tid="team-channel-item"], [data-tid="channel-list-item"], [data-tid="channel-name"], [role="treeitem"]'
    );
    channelNodes.forEach((node) => {
      const name = (node.textContent || '').trim().split('\\n')[0].trim();
      const lower = name.toLowerCase();
      if (name && !seen.has(lower) && !systemWords.has(lower)) {
        seen.add(lower);
        const id = node.getAttribute('data-tid') || node.getAttribute('id') || name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        results.push({
          id,
          name,
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
      const titleEl = node.querySelector('[data-tid="chat-list-item-title"], [data-tid="chat-title"], h2, h3, span[title], span[dir="auto"], p');
      const rawName = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : (node.textContent || '').trim().split('\\n')[0].trim();
      const name = rawName.replace(/\\s*\\(You\\)$/i, '').trim();
      const lower = name.toLowerCase();
      if (name && !seen.has(lower) && !systemWords.has(lower)) {
        seen.add(lower);
        const id = 'teams_chat_' + name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        results.push({
          id,
          name: rawName,
          isPrivate: true,
          isDm: true,
          kind: 'dm'
        });
      }
    });

    // 3. If list virtualized or empty, check active conversation header
    const headerTitleEl = document.querySelector(
      '[data-tid="chat-header-title"], [data-tid="channel-header-title"], [data-tid="header-title"], header h1, header h2, header [role="heading"]'
    );
    if (headerTitleEl) {
      const activeName = (headerTitleEl.textContent || '').trim().replace(/\\s*\\(You\\)$/i, '').trim();
      const lower = activeName.toLowerCase();
      if (activeName && !seen.has(lower) && !systemWords.has(lower)) {
        seen.add(lower);
        results.push({
          id: 'teams_chat_' + activeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
          name: (headerTitleEl.textContent || '').trim(),
          isPrivate: true,
          isDm: true,
          kind: 'dm'
        });
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
    const activeChatName = headerEl ? (headerEl.textContent || '').trim().replace(/\\s*\\(You\\)$/i, '') : 'Teams Member';

    const messageNodes = document.querySelectorAll(
      '[data-tid="message-pane-list-viewport"] [role="listitem"], [data-tid="chat-pane-item"], div[data-tid*="chat-message"], .ui-chat__message, div[role="listitem"] div[data-tid="message-body"]'
    );

    messageNodes.forEach((node, idx) => {
      const container = node.closest('[role="listitem"]') || node;
      const senderEl = container.querySelector('[data-tid="message-author-name"], [data-tid="message-author"], .ui-chat__message__author, span[data-tid="author"]');
      const bodyEl = container.querySelector('[data-tid="message-body"], .ui-chat__message__content, [data-tid="chat-message-text"], p');
      const timeEl = container.querySelector('time, [data-tid="message-timestamp"]');

      let senderName = senderEl ? (senderEl.textContent || '').trim() : '';
      if (!senderName) {
        senderName = activeChatName;
      }
      const text = bodyEl ? (bodyEl.innerHTML || bodyEl.textContent || '').trim() : '';
      const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '') : new Date().toISOString();

      if (text) {
        messages.push({
          id: 'teams_msg_' + idx + '_' + Date.now(),
          channelId: 'active_channel',
          senderId: senderName.toLowerCase().replace(/\\s+/g, '_'),
          senderName,
          text,
          timestamp
        });
      }
    });

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

  constructor(options: TeamsReaderOptions) {
    this.profileId = options.profileId
    if (options.existingView) {
      this.view = options.existingView
      this.ownsView = false
    }
  }

  async initialize(): Promise<void> {
    if (this.view) return
    const partition = partitionForProfile(this.profileId, 'teams')
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
        return raw.map((item) => ({
          id: String(item.id || item.name),
          name: String(item.name),
          isPrivate: Boolean(item.isPrivate),
          isDm: Boolean(item.isDm),
          kind: item.isDm ? 'dm' : item.isPrivate ? 'private' : 'public'
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
            const target = ${JSON.stringify(channelId)}.toLowerCase().trim();
            const nodes = document.querySelectorAll(
              '[data-tid="team-channel-item"], [data-tid="channel-list-item"], [data-tid="chat-list-item"], [role="treeitem"], [role="listitem"]'
            );
            for (const node of nodes) {
              const tid = (node.getAttribute('data-tid') || '').toLowerCase();
              const id = (node.getAttribute('id') || '').toLowerCase();
              const text = (node.textContent || '').toLowerCase().trim();
              if (tid === target || id === target || text.includes(target) || target.includes(text)) {
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

  async postMessage(_channelId: string, text: string): Promise<boolean> {
    void _channelId
    if (!this.view || this.view.webContents.isDestroyed()) {
      return false
    }
    try {
      const script = `
        (() => {
          try {
            const msg = ${JSON.stringify(text)};
            const box = document.querySelector(
              '[data-tid="ckeditor-replyConversation"], [role="textbox"][contenteditable="true"], .ck-editor__editable, textarea'
            );
            if (!box) return false;
            box.focus();
            if (box.isContentEditable) {
              document.execCommand('insertText', false, msg);
            } else {
              box.value = msg;
              box.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const sendBtn = document.querySelector(
              '[data-tid="sendButton"], button[aria-label*="Send"], button[title*="Send"]'
            );
            if (sendBtn) {
              sendBtn.click();
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
      // Allow garbage collector to clean up
      this.view = null
    }
  }
}
