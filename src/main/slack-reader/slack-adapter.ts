import type { WebContentsView } from 'electron'
import { SLACK_SELECTORS } from './slack-selectors'
import type { RawScrapedMessage } from './normalizer'

export type SlackSessionState = 'logged_in' | 'needs_login' | 'challenge' | 'unknown'

export interface ScrapedChannelItem {
  id: string
  name: string
  isPrivate: boolean
  isDm?: boolean
  hasUnread: boolean
}

/**
 * Passive, read-only script evaluated in the page context to detect authentication/session state.
 */
export const DETECT_STATE_SCRIPT = `
(function() {
  const url = window.location.href;
  if (url.includes('/signin') || url.includes('/oauth')) {
    return 'needs_login';
  }
  if (document.querySelector('${SLACK_SELECTORS.challengeIndicator}')) {
    return 'challenge';
  }
  if (
    url.includes('/client/') ||
    url.includes('/messages/') ||
    document.querySelector('${SLACK_SELECTORS.loggedInIndicator}')
  ) {
    return 'logged_in';
  }
  return 'unknown';
})()
`

/**
 * Passive script to list channels and their unread status from the sidebar DOM.
 */
export const LIST_CHANNELS_SCRIPT = `
(function() {
  const channels = [];
  const seenIds = new Set();
  const items = document.querySelectorAll('${SLACK_SELECTORS.channelItem}');
  items.forEach((item) => {
    // Detect if this is a direct message container or user row
    const isUserItem =
      item.classList.contains('p-channel_sidebar__item--user') ||
      Boolean(item.querySelector('[data-qa-channel-sidebar-item="user"]')) ||
      Boolean(item.closest('[data-qa="channel_sidebar_section_users"]')) ||
      Boolean(item.closest('[data-qa="channel_sidebar_section_dms"]'));

    const nameEl = item.querySelector('${SLACK_SELECTORS.channelName}');
    const badgeEl = item.querySelector('${SLACK_SELECTORS.channelUnreadBadge}');
    const linkEl = item.querySelector('a[href]');
    const name = nameEl ? nameEl.textContent.trim() : (item.textContent || '').trim().split('\\n')[0].trim();
    if (!name) return;

    let id = '';
    // Priority 1: Official data-qa attribute on item or link (e.g. data-qa-channel-sidebar-channel-id="C0123...")
    const dataQaId =
      item.getAttribute('data-qa-channel-sidebar-channel-id') ||
      (linkEl ? linkEl.getAttribute('data-qa-channel-sidebar-channel-id') : '') ||
      item.getAttribute('data-channel-id') ||
      (linkEl ? linkEl.getAttribute('data-channel-id') : '');

    if (dataQaId) {
      id = dataQaId.trim();
    } else {
      // Priority 2: Standard Slack client URL structure (/messages/ID or /client/T.../ID)
      const href = linkEl ? linkEl.getAttribute('href') || '' : '';
      const match = href.match(/\\/messages\\/([^/?]+)/) || href.match(/\\/client\\/[^/]+\\/([^/?]+)/);
      if (match && match[1]) {
        id = match[1];
      } else {
        // Priority 3: data-item-key or role attributes
        const itemKey = item.getAttribute('data-item-key') || '';
        const keyMatch = itemKey.match(/([CGD][A-Z0-9]{8,12})/);
        if (keyMatch) {
          id = keyMatch[1];
        } else {
          id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        }
      }
    }

    if (!id || seenIds.has(id)) return;
    seenIds.add(id);

    const ariaLabel = item.getAttribute('aria-label') || '';
    const isPrivate =
      ariaLabel.toLowerCase().includes('private') ||
      name.startsWith('🔒') ||
      id.startsWith('G') ||
      Boolean(item.querySelector('[data-qa="channel_icon_private"]')) ||
      Boolean(item.querySelector('.c-icon--lock'));

    const isDm = isUserItem || id.startsWith('D') || ariaLabel.toLowerCase().includes('direct message');

    channels.push({
      id,
      name,
      isPrivate,
      isDm,
      hasUnread: Boolean(badgeEl)
    });
  });
  return channels;
})()
`

/**
 * Passive script to read visible messages from the virtualized message list DOM.
 * Performs ZERO typing, ZERO sending, ZERO clicking.
 * Strictly filters messages to the last 1 hour window.
 */
export const READ_VISIBLE_MESSAGES_SCRIPT = `
(function() {
  const rows = document.querySelectorAll('${SLACK_SELECTORS.messageRow}');
  const results = [];
  let lastAuthor = null;
  const oneHourAgoSec = (Date.now() - 3600 * 1000) / 1000;

  rows.forEach((row) => {
    const senderEl = row.querySelector('${SLACK_SELECTORS.messageSender}');
    const tsEl = row.querySelector('${SLACK_SELECTORS.messageTimestamp}');
    const bodyEl = row.querySelector('${SLACK_SELECTORS.messageBody}');

    // If an author header exists on this row, update lastAuthor
    if (senderEl) {
      const authorText = senderEl.textContent.trim();
      if (authorText) {
        lastAuthor = authorText;
      }
    }

    // Extract timestamp from data-ts attribute, datetime, or text
    let rawTs = tsEl ? (tsEl.getAttribute('data-ts') || tsEl.getAttribute('datetime') || tsEl.textContent.trim()) : '';
    const sender = lastAuthor || 'Anonymous';
    const text = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';

    const permalinkEl = row.querySelector('a[href*="/archives/"]');
    const permalink = permalinkEl ? permalinkEl.getAttribute('href') : '';

    if (rawTs && text) {
      // Numerical timestamp parsing check for 1 hour window
      const parsedNum = parseFloat(rawTs);
      if (!isNaN(parsedNum) && parsedNum > 1000000000) {
        if (parsedNum < oneHourAgoSec) {
          return; // Skip messages older than 1 hour
        }
      }

      results.push({
        rawTs,
        sender,
        text,
        permalink: permalink || undefined
      });
    }
  });

  return results;
})()
`

export class SlackAdapter {
  async detectState(view: WebContentsView): Promise<SlackSessionState> {
    if (view.webContents.isDestroyed()) return 'unknown'
    try {
      const state = (await view.webContents.executeJavaScript(DETECT_STATE_SCRIPT, true)) as SlackSessionState
      return state ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  async listChannels(view: WebContentsView): Promise<ScrapedChannelItem[]> {
    if (view.webContents.isDestroyed()) return []
    try {
      const channels = (await view.webContents.executeJavaScript(LIST_CHANNELS_SCRIPT, true)) as ScrapedChannelItem[]
      return Array.isArray(channels) ? channels : []
    } catch {
      return []
    }
  }

  async readVisibleMessages(view: WebContentsView): Promise<RawScrapedMessage[]> {
    if (view.webContents.isDestroyed()) return []
    try {
      const messages = (await view.webContents.executeJavaScript(READ_VISIBLE_MESSAGES_SCRIPT, true)) as RawScrapedMessage[]
      return Array.isArray(messages) ? messages : []
    } catch {
      return []
    }
  }

  async postMessageViaDom(view: WebContentsView, text: string): Promise<boolean> {
    if (view.webContents.isDestroyed()) return false
    const script = `
(function() {
  const editor = document.querySelector('${SLACK_SELECTORS.composerEditor}');
  if (!editor) return false;
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, ${JSON.stringify(text)});
  editor.dispatchEvent(new Event('input', { bubbles: true }));

  setTimeout(() => {
    const sendBtn = document.querySelector('${SLACK_SELECTORS.composerSendButton}');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  }, 300);
  return true;
})()
`
    try {
      return Boolean(await view.webContents.executeJavaScript(script, true))
    } catch {
      return false
    }
  }
}
