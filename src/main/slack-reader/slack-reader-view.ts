import { WebContentsView } from 'electron'
import { partitionForProfile, partitionForCard } from '../profiles/session-partition'
import { log } from '../logging'
import { SlackAdapter, type SlackSessionState, type ScrapedChannelItem } from './slack-adapter'
import { deduplicateMessages, normalizeScrapedMessage } from './normalizer'
import type { DashboardStoredMessage } from '../dashboard/delta-store'

export interface ScrapeStepEvent {
  type: 'navigate' | 'scroll' | 'highlight' | 'status' | 'run_finished' | 'run_failed' | 'paused' | 'waiting_for_user' | 'challenge' | 'read' | 'queued'
  workspaceName?: string
  channelName?: string
  scrollIndex?: number
  maxScroll?: number
  messageCount?: number
  queueLength?: number
  bounds?: { x: number; y: number; width: number; height: number }
  text?: string
  snippet?: string
  sender?: string
  timestamp?: string
}

export interface SlackReaderOptions {
  profileId: string
  workspaceId: string
  projectId?: string
  existingView?: WebContentsView | null
  onEvent?: (event: ScrapeStepEvent) => void
}

export class SlackReaderView {
  private view: WebContentsView | null = null
  private isBorrowedView = false
  private readonly adapter = new SlackAdapter()
  private readonly profileId: string
  private readonly workspaceId: string
  private readonly projectId?: string
  private readonly onEvent?: (event: ScrapeStepEvent) => void

  constructor(options: SlackReaderOptions) {
    this.profileId = options.profileId
    this.workspaceId = options.workspaceId
    this.projectId = options.projectId
    this.onEvent = options.onEvent
    if (options.existingView && !options.existingView.webContents.isDestroyed()) {
      this.view = options.existingView
      this.isBorrowedView = true
    }
  }

  /**
   * Initializes the view. If an active session view is provided, reuses it.
   * Otherwise initializes the background view using the card or profile's dedicated session partition.
   */
  async initialize(): Promise<void> {
    if (this.view && !this.view.webContents.isDestroyed()) return

    const partition = this.projectId
      ? partitionForCard(this.projectId, 'slack')
      : partitionForProfile(this.profileId, 'slack')

    this.view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    // Strict URL allowlist: reader view only loads Slack domain URLs
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.view.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url)
        if (!parsed.hostname.endsWith('slack.com')) {
          event.preventDefault()
          log.warn('slack reader blocked external navigation', { url })
        }
      } catch {
        event.preventDefault()
      }
    })

    // Position view offscreen so it runs 100% passively in the background
    this.view.setBounds({ x: -10000, y: -10000, width: 1280, height: 800 })
  }

  async checkState(): Promise<SlackSessionState> {
    if (!this.view) await this.initialize()
    return this.adapter.detectState(this.view!)
  }

  async listChannels(): Promise<ScrapedChannelItem[]> {
    if (!this.view) await this.initialize()
    const state = await this.checkState()
    if (state !== 'logged_in') return []
    return this.adapter.listChannels(this.view!)
  }

  /**
   * Reads visible messages from a specific channel by passive deep-link navigation.
   * Performs ZERO clicking, typing, or API token extraction.
   */
  async readChannelMessages(channelId: string): Promise<DashboardStoredMessage[]> {
    if (!this.view) await this.initialize()
    const state = await this.checkState()
    if (state !== 'logged_in') {
      log.info('slack reader cannot read channel: session not logged in', { state })
      return []
    }

    const channelUrl = `https://app.slack.com/client/${this.workspaceId}/${channelId}`
    const currentUrl = this.view!.webContents.getURL()

    this.onEvent?.({
      type: 'navigate',
      channelName: channelId,
      text: `Navigating to channel ${channelId}…`
    })

    if (!currentUrl.includes(`/${this.workspaceId}/${channelId}`)) {
      try {
        await this.view!.webContents.loadURL(channelUrl)
      } catch (err: any) {
        // Chromium throws ERR_ABORTED (-3) if Slack's SPA client redirect intervenes.
        // If the URL actually navigated or contains the channel, this is non-fatal.
        const finalUrl = this.view!.webContents.getURL()
        if (!finalUrl.includes(channelId) && !err.message?.includes('ERR_ABORTED')) {
          throw err
        }
      }
      // Allow DOM to settle passively
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }

    this.onEvent?.({
      type: 'status',
      channelName: channelId,
      text: `Reading visible messages in ${channelId}…`
    })

    // Inspect active message container bounds for highlight overlay
    try {
      const bounds = await this.view!.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('.c-virtual_list__item') || document.querySelector('[data-qa="message_container"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()
      `, true)
      if (bounds) {
        this.onEvent?.({
          type: 'highlight',
          bounds,
          channelName: channelId
        })
      }
    } catch {
      // ignore
    }

    const rawMessages = await this.adapter.readVisibleMessages(this.view!)
    const normalized: DashboardStoredMessage[] = []

    for (const raw of rawMessages) {
      const msg = normalizeScrapedMessage(raw, channelId)
      if (msg) normalized.push(msg)
    }

    this.onEvent?.({
      type: 'status',
      channelName: channelId,
      messageCount: normalized.length,
      text: `Read ${normalized.length} messages in ${channelId}`
    })

    return deduplicateMessages(this.workspaceId, channelId, normalized)
  }

  /**
   * Navigates to the channel and posts a message via DOM input fallback.
   */
  async postChannelMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.view) await this.initialize()
    const state = await this.checkState()
    if (state !== 'logged_in') return false

    const channelUrl = `https://app.slack.com/client/${this.workspaceId}/${channelId}`
    const currentUrl = this.view!.webContents.getURL()

    if (!currentUrl.includes(`/${this.workspaceId}/${channelId}`)) {
      await this.view!.webContents.loadURL(channelUrl)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    return this.adapter.postMessageViaDom(this.view!, text)
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setBounds(bounds)
    }
  }

  getView(): WebContentsView | null {
    return this.view
  }

  destroy(): void {
    if (!this.isBorrowedView && this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.close()
    }
    this.view = null
  }
}
