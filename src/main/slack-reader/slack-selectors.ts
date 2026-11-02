/**
 * Stable, versioned selectors for passive read-only scraping of Slack Web.
 * Uses official data-qa attributes where available, with standard class fallbacks.
 */
export const SLACK_SELECTORS = {
  // Elements indicating a fully loaded and logged-in Slack client
  loggedInIndicator:
    '[data-qa="workspace_navigation"], #client-ui, .p-client_container, [data-qa="channel_sidebar_name_page"]',

  // Authentication challenge / verification indicators (requires user intervention)
  challengeIndicator:
    'input[name="password"], [data-qa="signin_password_input"], .p-signin_password, [data-qa="two_factor_auth_input"], #challenge, iframe[src*="recaptcha"]',

  // Channel + DM sidebar elements. DMs are included but flagged by the reader
  // script (`isDm`); the sync engine decides whether they are in scope.
  channelListContainer: '[data-qa="channel_sidebar_name_page"], .p-channel_sidebar__list',
  channelItem:
    '[data-qa="channel_sidebar_name_page"] [role="treeitem"], .p-channel_sidebar__channel, .p-channel_sidebar__item--user, [data-qa-channel-sidebar-item="true"], [data-qa-channel-sidebar-channel-id]',
  channelName: '.p-channel_sidebar__name, [data-qa="channel_sidebar_name"], span[data-qa="channel_sidebar_name"]',
  channelUnreadBadge:
    '.p-channel_sidebar__badge, [data-qa="channel-sidebar-unread-badge"], .c-mention_badge',

  // Message list and message elements
  messageListContainer: '[data-qa="slack_kit_list"], .c-virtual_list__scroll_container, [role="list"]',
  messageRow: '[data-qa="message_container"], .c-message_kit__message, .c-virtual_list__item',
  messageSender: '[data-qa="message_sender_name"], .c-message__sender_button',
  messageTimestamp: '[data-qa="timestamp"], .c-timestamp',
  messageBody: '[data-qa="message-text"], .c-message_kit__blocks .p-rich_text_section, .p-rich_text_section',

  // Message composer input & send button (for active posting)
  composerEditor: '.ql-editor[contenteditable="true"], [data-qa="message_input"], [role="textbox"][contenteditable="true"]',
  composerSendButton: '[data-qa="texty_send_button"], button[aria-label="Send message"]'
} as const
