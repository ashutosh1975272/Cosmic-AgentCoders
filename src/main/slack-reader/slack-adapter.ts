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
 * `sinceTs` is an epoch-seconds floor (0 = no floor, so the caller can page
 * backwards through history instead of being pinned to the last hour).
 */
export function buildReadVisibleMessagesScript(sinceTs = 0): string {
  const floor = Number.isFinite(sinceTs) && sinceTs > 0 ? sinceTs : 0
  return `
(function() {
  const rows = document.querySelectorAll('${SLACK_SELECTORS.messageRow}');
  const results = [];
  let lastAuthor = null;
  const sinceTs = ${floor};

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

    // Extract permalink if present
    const permalinkEl = row.querySelector('a[href*="/archives/"]');
    const permalink = permalinkEl ? permalinkEl.getAttribute('href') : '';

    // Extract exact timestamp from data-ts, data-item-key, archives permalink, or ts element
    let pTs = '';
    if (permalink && permalink.indexOf('/p') !== -1) {
      const pIdx = permalink.lastIndexOf('/p');
      const pDigits = permalink.slice(pIdx + 2).replace(/[^0-9]/g, '');
      if (pDigits.length >= 16) {
        pTs = pDigits.slice(0, 10) + '.' + pDigits.slice(10, 16);
      }
    }

    let rawTs =
      (tsEl ? tsEl.getAttribute('data-ts') : '') ||
      (row.getAttribute('data-item-key') && row.getAttribute('data-item-key').length >= 10 ? row.getAttribute('data-item-key') : '') ||
      (row.getAttribute('data-ts') || '') ||
      pTs ||
      (tsEl ? (tsEl.getAttribute('datetime') || tsEl.textContent.trim()) : '');

    const sender = lastAuthor || 'Anonymous';

    // Extract attachments, files (e.g. Word .docx, pdfs, images)
    const attachmentEls = row.querySelectorAll(
      '[data-qa="file_container"], .c-file_container, .c-file__title, .p-file_title, [data-qa="file_title"], .c-message_attachment, a[href*="/files/"]'
    );
    const fileNames = [];
    attachmentEls.forEach((att) => {
      const titleEl = att.querySelector('.c-file__title, [data-qa="file_title"], .p-file_title') || att;
      const fName = (titleEl.textContent || titleEl.innerText || '').trim();
      if (fName && fileNames.indexOf(fName) === -1 && fName.indexOf(String.fromCharCode(10)) === -1 && fName.length < 200) {
        fileNames.push(fName);
      }
    });

    let text = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
    if (fileNames.length > 0) {
      const fileText = fileNames.map((fn) => '[Document: ' + fn + ']').join(' ');
      text = text ? text + ' ' + fileText : fileText;
    }

    if (rawTs && text) {
      const parsedNum = parseFloat(rawTs);
      if (sinceTs > 0 && !isNaN(parsedNum) && parsedNum > 1000000000 && parsedNum < sinceTs) {
        return;
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
}

export const READ_VISIBLE_MESSAGES_SCRIPT = buildReadVisibleMessagesScript(0)

export class SlackAdapter {
  async detectState(view: WebContentsView): Promise<SlackSessionState> {
    if (!view || view.webContents?.isDestroyed()) return 'unknown'
    try {
      const state = (await view.webContents.executeJavaScript(DETECT_STATE_SCRIPT, true)) as SlackSessionState
      return state ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  async listChannels(view: WebContentsView): Promise<ScrapedChannelItem[]> {
    if (!view || view.webContents?.isDestroyed()) return []
    try {
      const channels = (await view.webContents.executeJavaScript(LIST_CHANNELS_SCRIPT, true)) as ScrapedChannelItem[]
      return Array.isArray(channels) ? channels : []
    } catch {
      return []
    }
  }

  async readVisibleMessages(
    view: WebContentsView,
    options: { sinceTs?: number } = {}
  ): Promise<RawScrapedMessage[]> {
    if (!view || view.webContents?.isDestroyed()) return []
    try {
      const script = buildReadVisibleMessagesScript(options.sinceTs ?? 0)
      const messages = (await view.webContents.executeJavaScript(script, true)) as RawScrapedMessage[]
      return Array.isArray(messages) ? messages : []
    } catch {
      return []
    }
  }

  /** Scroll the message list up (older history) without clicking anything. */
  async scrollUp(view: WebContentsView, pixels = 600): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
    try {
      return Boolean(
        await view.webContents.executeJavaScript(
          `(function() {
            const list = document.querySelector('.c-virtual_list__scroll_container') ||
                         document.querySelector('[data-qa="slack_kit_list"]');
            if (!list) return false;
            const before = list.scrollTop;
            list.scrollTop = Math.max(0, before - ${Math.max(100, pixels)});
            return list.scrollTop < before;
          })()`,
          true
        )
      )
    } catch {
      return false
    }
  }

  async postMessageViaDom(view: WebContentsView, text: string): Promise<boolean> {
    if (!view || view.webContents?.isDestroyed()) return false
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
