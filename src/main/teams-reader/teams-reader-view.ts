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

export function buildTeamsDirectReadScript(targetChatId: string, targetChatName?: string): string {
  const cleanSlug = targetChatId
    .replace(/^teams_chat_/i, '')
    .replace(/^teams_ch_/i, '')
    .replace(/_+/g, ' ')
    .toLowerCase()
    .trim()
  const cleanName = (targetChatName || '').replace(/^[#@]+/, '').toLowerCase().trim()
  const targetId = targetChatId.toLowerCase().trim()

  return `
    (async () => {
      try {
        const targetId = ${JSON.stringify(targetId)};
        const cleanSlug = ${JSON.stringify(cleanSlug)};
        const targetName = ${JSON.stringify(cleanName)};

        const matches = (candidate) => {
          if (!candidate) return false;
          const cand = String(candidate).toLowerCase().trim();
          const candAlpha = cand.replace(/[^\\p{L}\\p{N}]/gu, '');
          const slugAlpha = cleanSlug.replace(/[^\\p{L}\\p{N}]/gu, '');
          const nameAlpha = targetName.replace(/[^\\p{L}\\p{N}]/gu, '');
          const idAlpha = targetId.replace(/[^\\p{L}\\p{N}]/gu, '');

          if (cand === targetId || cand === cleanSlug || (targetName && cand === targetName)) return true;
          if (candAlpha.length >= 2) {
            if (slugAlpha.length >= 2 && (candAlpha === slugAlpha || candAlpha.includes(slugAlpha) || slugAlpha.includes(candAlpha))) return true;
            if (nameAlpha.length >= 2 && (candAlpha === nameAlpha || candAlpha.includes(nameAlpha) || nameAlpha.includes(candAlpha))) return true;
            if (idAlpha.length >= 2 && (candAlpha === idAlpha || candAlpha.includes(idAlpha))) return true;
          }
          return false;
        };

        const stripHtml = (html) => {
          if (!html) return '';
          return String(html)
            .replace(/<at id="[^"]*">([^<]+)<\\/at>/gi, '@$1')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
        };

        if (typeof window === 'undefined' || !window.indexedDB) return [];

        const idbResult = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve([]), 1500);
          try {
            if (typeof window.indexedDB.databases !== 'function') {
              clearTimeout(timer);
              resolve([]);
              return;
            }

            window.indexedDB.databases().then(async (dbs) => {
              try {
                if (!Array.isArray(dbs) || dbs.length === 0) {
                  clearTimeout(timer);
                  resolve([]);
                  return;
                }

                // Filter for Teams databases caching replychains or messages
                const relevantDbs = dbs.filter((d) =>
                  d.name && (
                    d.name.includes('replychain') ||
                    d.name.includes('streams-replychain') ||
                    d.name.startsWith('Teams:')
                  )
                );

                if (relevantDbs.length === 0) {
                  clearTimeout(timer);
                  resolve([]);
                  return;
                }

                const allExtractedMessages = [];

                for (const dbInfo of relevantDbs) {
                  try {
                    const db = await new Promise((resDb, rejDb) => {
                      const req = window.indexedDB.open(dbInfo.name);
                      req.onsuccess = () => resDb(req.result);
                      req.onerror = () => rejDb(req.error);
                    });

                    const storeNames = Array.from(db.objectStoreNames || []);
                    for (const storeName of storeNames) {
                      try {
                        const items = await new Promise((resItems) => {
                          const tx = db.transaction(storeName, 'readonly');
                          const store = tx.objectStore(storeName);
                          const req = store.getAll();
                          req.onsuccess = () => resItems(req.result || []);
                          req.onerror = () => resItems([]);
                        });

                        for (const item of items) {
                          if (!item) continue;
                          const conversationId = item.conversationId || item.chatId || item.id || '';
                          const threadTopic = item.threadProperties?.topic || item.topic || '';
                          const isChatMatch = matches(conversationId) || matches(threadTopic);

                          // Check item.messageMap (Teams V2 replychain structure)
                          const rawMsgs = [];
                          if (item.messageMap && typeof item.messageMap === 'object') {
                            for (const k of Object.keys(item.messageMap)) {
                              rawMsgs.push(item.messageMap[k]);
                            }
                          } else if (Array.isArray(item.messages)) {
                            rawMsgs.push(...item.messages);
                          } else if (item.lastMessage) {
                            rawMsgs.push(item.lastMessage);
                          } else if (item.content || item.body) {
                            rawMsgs.push(item);
                          }

                          for (const m of rawMsgs) {
                            if (!m) continue;
                            const text = stripHtml(m.content || m.body || m.preview || '');
                            if (!text) continue;

                            const senderName = (
                              m.imdisplayName ||
                              m.imDisplayName ||
                              m.senderName ||
                              m.fromDisplayName ||
                              m.from ||
                              ''
                            ).replace(/\\s*\\(You\\)$/i, '').trim();

                            const isMsgMatch = isChatMatch || matches(senderName);
                            if (!isMsgMatch && targetName && cleanSlug) {
                              continue;
                            }

                            const rawTime = m.clientArrivalTime || m.composetime || m.originalArrivalTime || m.timestamp || m.t;
                            let timestamp = rawTime;
                            if (typeof rawTime === 'number' && rawTime > 1e11) {
                              timestamp = new Date(rawTime).toISOString();
                            }

                            allExtractedMessages.push({
                              id: String(m.clientmessageid || m.id || m.skypeGuid || Date.now() + Math.random()),
                              channelId: targetId,
                              senderName: senderName || (m.isFromMe ? 'You' : targetName || 'Teams Member'),
                              text,
                              timestamp: timestamp || new Date().toISOString()
                            });
                          }
                        }
                      } catch {
                        // next store
                      }
                    }
                    db.close();
                  } catch {
                    // next db
                  }
                }

                clearTimeout(timer);
                resolve(allExtractedMessages.slice(-50));
              } catch {
                clearTimeout(timer);
                resolve([]);
              }
            }).catch(() => {
              clearTimeout(timer);
              resolve([]);
            });
          } catch {
            clearTimeout(timer);
            resolve([]);
          }
        });

        if (Array.isArray(idbResult) && idbResult.length > 0) {
          return idbResult;
        }
        return [];
      } catch {
        return [];
      }
    })()
  `
}

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

  async readMessages(channelId: string, expectedName?: string): Promise<DashboardStoredMessage[]> {
    if (!this.view || this.view.webContents.isDestroyed()) {
      return []
    }
    try {
      // 1. Direct IndexedDB extraction (Zero-DOM, ~20-50ms)
      const directScript = buildTeamsDirectReadScript(channelId, expectedName)
      const directRaw = await this.view.webContents.executeJavaScript(directScript, true)
      if (Array.isArray(directRaw) && directRaw.length > 0) {
        return directRaw.map((m: RawTeamsMessage) => normalizeTeamsMessage(m, channelId))
      }

      // 2. Fallback to DOM extraction
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

            // 1. Check if the active chat header already matches
            const headerEl = document.querySelector(
              '[data-tid="chat-header-title"], [data-tid="channel-header-title"], header h1, header h2'
            );
            const activeHeader = headerEl ? (headerEl.textContent || '').toLowerCase().trim() : '';
            if (activeHeader && (activeHeader.includes(cleanTarget) || (cleanTarget && cleanTarget.includes(activeHeader)))) {
              return true;
            }

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

      // 2. Type text into Teams V2 composer, resolving to the actual contenteditable node
      const typeScript = `
        (() => {
          try {
            const msg = ${JSON.stringify(text)};
            // Match editable composer node or resolve inner contenteditable
            let box = document.querySelector(
              '[contenteditable="true"][role="textbox"], [data-tid="new-message-textarea"] [contenteditable="true"], div[aria-label*="Type a message"] [contenteditable="true"], [data-tid="new-message-textarea"], div[aria-label="Type a message"], div[aria-label*="Type a message"], [data-tid="ckeditor-replyConversation"], [role="textbox"][contenteditable="true"], .ck-editor__editable, textarea'
            );
            if (!box) return { ok: false, error: 'composer_not_found' };

            if (!box.isContentEditable && box.querySelector) {
              const inner = box.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
              if (inner) box = inner;
            }

            box.focus();

            if (box.isContentEditable) {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, msg);
              try {
                box.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: msg }));
                box.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: msg }));
              } catch {}
              box.dispatchEvent(new Event('input', { bubbles: true }));
              box.dispatchEvent(new Event('change', { bubbles: true }));

              if (!box.textContent || !box.textContent.trim()) {
                const escaped = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
                box.innerHTML = '<p>' + escaped + '</p>';
                box.dispatchEvent(new Event('input', { bubbles: true }));
                box.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } else {
              box.value = msg;
              box.dispatchEvent(new Event('input', { bubbles: true }));
              box.dispatchEvent(new Event('change', { bubbles: true }));
            }

            return { ok: true, hasText: Boolean(box.textContent?.trim() || box.value?.trim()) };
          } catch (err) {
            return { ok: false, error: String(err) };
          }
        })()
      `
      const typeRes = await this.view.webContents.executeJavaScript(typeScript, true)
      if (!typeRes || !typeRes.ok) {
        return false
      }

      // 3. Poll for up to 1800ms for Teams V2 send button to become enabled and click it
      const clickSendScript = `
        (() => {
          try {
            const candidates = Array.from(document.querySelectorAll(
              '[data-tid="sendMessageButton"], [data-tid="chat-send-message-button"], button[data-tid="sendButton"], button[aria-label*="Send" i], button[title*="Send" i], button[data-tid*="send" i], [role="button"][aria-label*="Send" i], span[data-tid="sendMessageButton"]'
            ));

            for (const el of candidates) {
              const btn = el.closest('button') || el;
              const isDis = btn.disabled ||
                btn.getAttribute('aria-disabled') === 'true' ||
                btn.getAttribute('disabled') !== null ||
                btn.classList.contains('disabled');

              if (!isDis) {
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                btn.click();
                return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        })()
      `

      const deadline = Date.now() + 1800
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150))
        const clicked = await this.view.webContents.executeJavaScript(clickSendScript, true)
        if (clicked) {
          await new Promise((r) => setTimeout(r, 300))
          return true
        }
      }

      // 4. Fallback: Dispatch trusted native Electron Enter key event
      try {
        if (!this.view.webContents.isDestroyed()) {
          this.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
          this.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
          await new Promise((r) => setTimeout(r, 400))
        }
      } catch {
        // Ignore in environments without real native webContents
      }

      // 5. Verification: Check if editor is cleared (indicating message was submitted)
      const verifyScript = `
        (() => {
          try {
            let box = document.querySelector(
              '[contenteditable="true"][role="textbox"], [data-tid="new-message-textarea"] [contenteditable="true"], div[aria-label*="Type a message"] [contenteditable="true"], [data-tid="new-message-textarea"], div[aria-label="Type a message"]'
            );
            if (box && !box.isContentEditable && box.querySelector) {
              const inner = box.querySelector('[contenteditable="true"]');
              if (inner) box = inner;
            }
            const currentText = (box ? (box.textContent || box.value || '') : '').trim();
            return { cleared: currentText === '' || currentText === '<br>' };
          } catch {
            return { cleared: true };
          }
        })()
      `
      const verifyRes = await this.view.webContents.executeJavaScript(verifyScript, true)
      return Boolean(verifyRes?.cleared ?? true)
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
