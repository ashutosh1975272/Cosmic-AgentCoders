import { SlackPoller, isSlackAuthFailure } from './slack-poller'
import { slackTokenKey } from './slack-throttle'
import type { InsightEngine } from './insight-engine'
import { SlackReaderView, type ScrapeStepEvent } from '../slack-reader/slack-reader-view'
import { RunLogStore } from './run-log-store'
import type {
  DashboardChannelDelta,
  DashboardMetrics,
  DashboardMonitor,
  DashboardProject,
  DashboardProjectSnapshot,
  DashboardSource,
  DashboardSyncProgressPayload,
  ProjectInsight
} from '../../shared/dashboard-contract'
import type { DashboardDeltaStore, DashboardStoredMessage } from './delta-store'
import type { InsightHistoryEntry } from './history-store'
import type { MonitorStore } from './monitor-store'
import type { WorkspaceMappingStore } from './workspace-mapping-store'
import { summarizeProject } from './summary-engine'
import { computeMetrics } from './metrics'

export interface DashboardPoller {
  fetchHistory(input: {
    token: string
    channelId: string
    afterTs?: string
    limit?: number
  }): Promise<{ messages: DashboardStoredMessage[]; hasMore: boolean }>
}

export interface OAuthTokenProvider {
  tryGet(profileId: string, teamId: string): Promise<string | null>
}

export interface ManualTokenProvider {
  getManualToken(key: string): Promise<string | null>
}

/** The one team workspace shared by every card (ticket 04). */
export interface TeamWorkspaceReader {
  getConnection(): Promise<{
    profileId: string
    teamId: string
    token: string | null
    channels: DashboardMonitor[]
    status?: 'connected' | 'needs-reconnect'
  } | null>
  /** Token-health write-back so Settings can show the reconnect badge. */
  setStatus?(status: 'connected' | 'needs-reconnect', atIso?: string): Promise<unknown>
}

/** One channel page fetched during the current sync cycle. */
type CycleHistoryPage = { messages: DashboardStoredMessage[]; hasMore: boolean }

/**
 * Cycle-scoped memo keyed by (token identity, channel, cursor): two cards on
 * one workspace share the fetch. Never kept across cycles — every incremental
 * cursor must be re-read fresh next time.
 */
export type CycleHistoryCache = Map<string, Promise<CycleHistoryPage>>

/** One workspace a sync run has to read. */
interface SyncWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  token: string
  monitors: DashboardMonitor[]
}

/** The same workspace without a token — enough to read what is already stored. */
interface StoredWorkspace {
  source: DashboardSource
  profileId: string
  teamId: string
  monitors: DashboardMonitor[]
}

/** v2.3 — lets the engine show the last AI insight without a network sync. */
export interface InsightReader {
  getLastInsight: (projectId: string) => Promise<ProjectInsight | null>
  getLastEntry: (projectId: string) => Promise<InsightHistoryEntry | null>
}

export interface DashboardSyncEngineDeps {
  monitorStore: MonitorStore
  deltaStore: DashboardDeltaStore
  oauthTokenProvider: OAuthTokenProvider
  manualTokenProvider?: ManualTokenProvider
  /** v3 — our team workspace (optional; a card still syncs its client workspace alone). */
  teamWorkspace?: TeamWorkspaceReader
  /** Phase 3 — workspace → cards mapping store (optional; cards sync their client workspace alone until mapped). */
  workspaceMapping?: WorkspaceMappingStore
  pollerFactory?: () => DashboardPoller
  onProgress?: (payload: DashboardSyncProgressPayload) => void
  /** diagnostics (never secrets) */
  log?: (msg: string) => void
  /** v2.3 — read-only access to the stored insights (cold start) */
  insightReader?: InsightReader
  /** Phase A — insight history for status-since, mood trend and "new since". */
  historyReader?: (projectId: string) => Promise<InsightHistoryEntry[]>
  /** Phase A — when this card's Dashboard was last looked at. */
  viewedStore?: { get(projectId: string): Promise<string | null> }
  /** v2.3 — called after a background sync (e.g. to refresh the digest) */
  onSynced?: (snapshots: DashboardProjectSnapshot[]) => void
  getExistingBrowserView?: (profileId: string, appId: 'slack') => any
  getExistingCardView?: (projectId: string, appId: 'slack') => any
}

export class DashboardSyncEngine {
  protected readonly monitorStore: MonitorStore
  private readonly deltaStore: DashboardDeltaStore
  private readonly oauthTokenProvider: OAuthTokenProvider
  private readonly manualTokenProvider?: ManualTokenProvider
  private readonly teamWorkspace: TeamWorkspaceReader | undefined
  private readonly workspaceMapping: WorkspaceMappingStore | undefined
  private readonly pollerFactory: () => DashboardPoller
  private readonly log: (msg: string) => void
  private readonly insightReader: InsightReader | undefined
  private readonly historyReader:
    ((projectId: string) => Promise<InsightHistoryEntry[]>) | undefined
  private readonly viewedStore: { get(projectId: string): Promise<string | null> } | undefined
  private readonly metricsCache: Map<string, { key: string; value: DashboardMetrics }> = new Map()
  private readonly onSynced: ((snapshots: DashboardProjectSnapshot[]) => void) | undefined
  private readonly getExistingBrowserView?: (profileId: string, appId: 'slack') => any
  private readonly getExistingCardView?: (projectId: string, appId: 'slack') => any
  private scrapeEventListener: ((event: ScrapeStepEvent) => void) | null = null
  private activeWatchReader: SlackReaderView | null = null
  private scrapeQueuePromise: Promise<any> = Promise.resolve()
  private scrapeQueueLength = 0

  setScrapeEventListener(listener: ((event: ScrapeStepEvent) => void) | null): void {
    this.scrapeEventListener = listener
  }

  getActiveWatchReader(): SlackReaderView | null {
    return this.activeWatchReader
  }
  private readonly progressCallbacks: Array<(payload: DashboardSyncProgressPayload) => void> = []
  /** per-project cached snapshot — rebuilt after any sync */
  private readonly lastResults: Map<string, DashboardProjectSnapshot> = new Map()

  constructor(deps: DashboardSyncEngineDeps) {
    this.monitorStore = deps.monitorStore
    this.deltaStore = deps.deltaStore
    this.oauthTokenProvider = deps.oauthTokenProvider
    this.manualTokenProvider = deps.manualTokenProvider
    this.teamWorkspace = deps.teamWorkspace
    this.workspaceMapping = deps.workspaceMapping
    this.pollerFactory = deps.pollerFactory ?? (() => new SlackPoller())
    this.log = deps.log ?? (() => undefined)
    this.insightReader = deps.insightReader
    this.historyReader = deps.historyReader
    this.viewedStore = deps.viewedStore
    this.onSynced = deps.onSynced
    this.getExistingBrowserView = deps.getExistingBrowserView
    this.getExistingCardView = deps.getExistingCardView
    if (deps.onProgress) this.progressCallbacks.push(deps.onProgress)
  }

  /** Register a progress listener (used by the IPC layer). Returns unsubscriber. */
  addProgressListener(cb: (payload: DashboardSyncProgressPayload) => void): () => void {
    this.progressCallbacks.push(cb)
    return () => {
      const idx = this.progressCallbacks.indexOf(cb)
      if (idx >= 0) this.progressCallbacks.splice(idx, 1)
    }
  }

  /** protected so subclasses can report diagnostics */
  protected logInfo(msg: string): void {
    this.log(msg)
  }

  private emitProgress(payload: DashboardSyncProgressPayload): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(payload)
      } catch {
        /* listener errors must not break syncing */
      }
    }
  }

  private progress(payload: DashboardSyncProgressPayload): void {
    this.emitProgress(payload)
  }

  protected async tokenFor(project: DashboardProject): Promise<string | null> {
    if (project.tokenSource === 'manual') {
      if (!project.manualTokenKey || !this.manualTokenProvider) return null
      return this.manualTokenProvider.getManualToken(project.manualTokenKey)
    }
    return this.oauthTokenProvider.tryGet(project.profileId, project.teamId)
  }

  /** Pull new messages for every channel of one workspace and append them. */
  private async syncWorkspace(
    workspace: SyncWorkspace,
    poller: DashboardPoller,
    historyCache?: CycleHistoryCache
  ): Promise<DashboardChannelDelta[]> {
    const perChannel: DashboardChannelDelta[] = []

    for (const monitor of workspace.monitors) {
      const before = await this.deltaStore.readSnapshotMeta(
        workspace.profileId,
        workspace.teamId,
        monitor.channelId
      )
      const cursor = before?.cursor

      const result = await this.cycleFetch(
        historyCache,
        workspace.token,
        monitor.channelId,
        cursor,
        () =>
          poller.fetchHistory({
            token: workspace.token,
            channelId: monitor.channelId,
            afterTs: cursor,
            limit: 200
          })
      )

      const stored = await this.deltaStore.appendMessages({
        profileId: workspace.profileId,
        teamId: workspace.teamId,
        channelId: monitor.channelId,
        channelName: monitor.channelName,
        messages: result.messages,
        source: workspace.source
      })

      const after = await this.deltaStore.readSnapshotMeta(
        workspace.profileId,
        workspace.teamId,
        monitor.channelId
      )

      perChannel.push({
        channelId: monitor.channelId,
        channelName: monitor.channelName,
        source: workspace.source,
        messageCount: after?.messageCount ?? stored.added,
        newMessageCount: stored.added,
        latestMessageAt: new Date(Number(stored.cursor) * 1000).toISOString(),
        cursor: stored.cursor,
        lastSyncAt: stored.lastSyncAt
      })
    }
    return perChannel
  }

  /** One page per (token identity, channel, cursor) per cycle — see CycleHistoryCache. */
  private cycleFetch(
    cache: CycleHistoryCache | undefined,
    token: string,
    channelId: string,
    cursor: string | undefined,
    load: () => Promise<CycleHistoryPage>
  ): Promise<CycleHistoryPage> {
    if (!cache) return load()
    const key = `${slackTokenKey(token)}|${channelId}|${cursor ?? ''}`
    const cached = cache.get(key)
    if (cached) return cached
    const created = load()
    cache.set(key, created)
    return created
  }

  /** Reflect our-team token health in Settings; identical states write nothing. */
  private async markTeamStatus(
    status: 'connected' | 'needs-reconnect',
    current?: 'connected' | 'needs-reconnect'
  ): Promise<void> {
    if (!this.teamWorkspace?.setStatus || current === status) return
    try {
      await this.teamWorkspace.setStatus(status, new Date().toISOString())
    } catch (err) {
      this.log(`[dashboard] team workspace status write failed: ${String(err)}`)
    }
  }

  /** Read our team workspace without throwing: a missing one is simply absent. */
  private async ourWorkspace(): Promise<{
    connection: {
      profileId: string
      teamId: string
      token: string | null
      channels: DashboardMonitor[]
      status?: 'connected' | 'needs-reconnect'
    } | null
    error: string | null
  }> {
    if (!this.teamWorkspace) return { connection: null, error: null }
    try {
      return { connection: await this.teamWorkspace.getConnection(), error: null }
    } catch (err) {
      return {
        connection: null,
        error: err instanceof Error ? err.message : 'could not read our workspace'
      }
    }
  }

  /** Workspaces this card reads: its own (always) and ours (when connected). */
  private async storedWorkspaces(
    project: DashboardProject
  ): Promise<{ workspaces: StoredWorkspace[]; error: string | null }> {
    // Phase 3: if project is mapped to a workspace, use that workspace ID instead
    // of the project's own teamId. Channels come from the project's own monitors.
    let teamId = project.teamId
    let profileId = project.profileId
    if (this.workspaceMapping) {
      const mappedWorkspace = await this.workspaceMapping.getWorkspaceForProject(project.id)
      if (mappedWorkspace) {
        teamId = mappedWorkspace
      }
    }
    const workspaces: StoredWorkspace[] = [
      {
        source: 'client',
        profileId,
        teamId,
        monitors: project.monitors
      }
    ]
    // project-level override channels take precedence over global pinned channels
    const { connection, error } = await this.ourWorkspace()
    const oursChannels =
      project.ourSlackChannels && project.ourSlackChannels.length > 0
        ? project.ourSlackChannels
        : (connection?.channels ?? [])
    if (oursChannels.length > 0) {
      workspaces.push({
        source: 'ours',
        profileId: connection?.profileId ?? project.profileId,
        teamId: connection?.teamId ?? project.teamId,
        monitors: oursChannels
      })
    }
    // token resolution handled in tokenFor via override; keep connection for error
    if (error) return { workspaces, error }
    return { workspaces, error: null }
  }

  private perChannelDelta(
    delta: {
      channel: { id: string; name: string }
      messages: DashboardStoredMessage[]
      cursor: string
      lastSyncAt: string
    },
    source: DashboardSource
  ): DashboardChannelDelta {
    return {
      channelId: delta.channel.id,
      channelName: delta.channel.name,
      source,
      messageCount: delta.messages.length,
      latestMessageAt: new Date(Number(delta.cursor) * 1000).toISOString(),
      cursor: delta.cursor,
      lastSyncAt: delta.lastSyncAt
    }
  }

  async syncProject(
    projectId: string,
    historyCache?: CycleHistoryCache
  ): Promise<DashboardProjectSnapshot | null> {
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return null

    // Phase 3: if project is mapped to a workspace, use that workspace ID
    // for token resolution instead of project.teamId. Channels stay as the
    // project's own monitors.
    let syncTeamId = project.teamId
    if (this.workspaceMapping) {
      const mappedWorkspace = await this.workspaceMapping.getWorkspaceForProject(project.id)
      if (mappedWorkspace) syncTeamId = mappedWorkspace
    }

    this.progress({
      syncing: true,
      projectId,
      current: 1,
      total: 1,
      phase: 'syncing',
      projectIds: [projectId]
    })

    try {
      const poller = this.pollerFactory()
      const browserSources = (project.sources ?? []).filter(
        (s) => s.kind === 'browser' && s.enabled !== false
      )
      const isBrowserOnly = project.sourcePreference === 'browser_only' && browserSources.length > 0

      let clientDeltas: DashboardChannelDelta[] = []

      if (!isBrowserOnly) {
        const token = await this.tokenFor({
          ...project,
          teamId: syncTeamId
        })
        if (token) {
          clientDeltas = await this.syncWorkspace(
            {
              source: 'client',
              profileId: project.profileId,
              teamId: syncTeamId,
              token,
              monitors: project.monitors
            },
            poller,
            historyCache
          )
        } else if (browserSources.length === 0) {
          throw new Error(
            project.tokenSource === 'manual'
              ? 'No manual token saved for this project yet'
              : 'Workspace not connected via OAuth yet'
          )
        }
      }

      // If project has active browser sources, scrape channels via SlackReaderView
      if (browserSources.length > 0) {
        for (const bSrc of browserSources) {
          if (!bSrc.profileId || !bSrc.workspaceId) continue
          const startTime = Date.now()
          let channelsRead = 0
          let newMessagesCount = 0
          const snippets: { channelId: string; channelName?: string; sender: string; ts: string; snippet: string }[] = []
          const effectiveWorkspaceName = bSrc.workspaceName || bSrc.workspaceId

          try {
            const existingView =
              this.getExistingCardView?.(project.id, 'slack') ??
              this.getExistingBrowserView?.(bSrc.profileId, 'slack')
            const reader = new SlackReaderView({
              profileId: bSrc.profileId,
              projectId: project.id,
              workspaceId: bSrc.workspaceId,
              existingView: existingView ?? null,
              onEvent: (ev) => this.scrapeEventListener?.({ ...ev, workspaceName: effectiveWorkspaceName })
            })
            this.activeWatchReader = reader
            const activeChannels = (bSrc.channels ?? []).filter((c) => c.enabled !== false)
            for (const ch of activeChannels) {
              const messages = await reader.readChannelMessages(ch.id)
              channelsRead++
              if (messages.length > 0) {
                const appendRes = await this.deltaStore.appendMessages({
                  profileId: bSrc.profileId,
                  teamId: bSrc.workspaceId,
                  channelId: ch.id,
                  channelName: ch.name,
                  messages,
                  source: 'client'
                })
                newMessagesCount += appendRes.added
                for (const m of messages.slice(-5)) {
                  snippets.push({
                    channelId: ch.id,
                    channelName: ch.name,
                    sender: m.user || 'Anonymous',
                    ts: m.ts,
                    snippet: (m.text || '').slice(0, 100)
                  })
                }
                clientDeltas.push({
                  channelId: ch.id,
                  channelName: ch.name,
                  messageCount: messages.length,
                  latestMessageAt: messages[messages.length - 1]?.ts ?? null,
                  cursor: appendRes.cursor,
                  lastSyncAt: appendRes.lastSyncAt
                })
              }
            }
            reader.destroy()
            if (this.activeWatchReader === reader) {
              this.activeWatchReader = null
            }

            // Update source stats
            const nowIso = new Date().toISOString()
            const updatedSources = (project.sources ?? []).map((s) =>
              s.id === bSrc.id
                ? {
                    ...s,
                    status: 'connected' as const,
                    lastReadAt: nowIso,
                    lastReadNewCount: newMessagesCount
                  }
                : s
            )
            await this.monitorStore.upsertProject({
              project: {
                ...project,
                sources: updatedSources
              }
            })

            const runLogStore = new RunLogStore({ rootDir: this.deltaStore.rootDir })
            await runLogStore.append({
              runId: `run-${Date.now().toString(36)}`,
              ts: nowIso,
              trigger: 'manual',
              projectId: project.id,
              sourceId: bSrc.id,
              sourceKind: 'browser',
              workspaceId: bSrc.workspaceId,
              channelsRead,
              newMessages: newMessagesCount,
              snippets: snippets.slice(0, 20),
              durationMs: Date.now() - startTime,
              llmCalls: 0,
              status: 'connected'
            })
          } catch (err) {
            this.log(`[dashboard] browser source ${bSrc.id} scrape error: ${String(err)}`)
          }
        }
      }

      // Our team workspace is additive: if it fails, the client sync still
      // counts and the card keeps showing the data it already had.
      let ourDeltas: DashboardChannelDelta[] = []
      let ourWorkspaceError: string | null = null
      const { connection, error: readError } = await this.ourWorkspace()
      if (readError) ourWorkspaceError = readError
      if (connection) {
        if (!connection.token) {
          ourWorkspaceError =
            'Our team workspace has no usable token. Reconnect it in Global settings.'
        } else if (connection.channels.length > 0) {
          try {
            ourDeltas = await this.syncWorkspace(
              {
                source: 'ours',
                profileId: connection.profileId,
                teamId: connection.teamId,
                token: connection.token,
                monitors: connection.channels
              },
              poller,
              historyCache
            )
            await this.markTeamStatus('connected', connection.status)
          } catch (err) {
            ourWorkspaceError = err instanceof Error ? err.message : 'our workspace sync failed'
            // Only a dead token flips the badge; a network blip must not.
            if (isSlackAuthFailure(err)) {
              await this.markTeamStatus('needs-reconnect', connection.status)
            }
            this.log(`[dashboard] our-workspace sync failed: ${ourWorkspaceError}`)
          }
        }
      }

      const perChannel = [...clientDeltas, ...ourDeltas]
      const messages = await this.collectMessages(project)
      const snapshot = summarizeProject({
        project,
        messages,
        netNewCount: perChannel.reduce(
          (acc, ch) =>
            acc +
            Math.max(
              0,
              ch.messageCount -
                (this.lastResults
                  .get(project.id)
                  ?.perChannel.find((c) => c.channelId === ch.channelId)?.messageCount ??
                  ch.messageCount)
            ),
          0
        ),
        perChannel,
        lastUpdatedAt: new Date().toISOString()
      })
      snapshot.ourWorkspaceError = ourWorkspaceError
      this.lastResults.set(project.id, snapshot)
      this.progress({
        syncing: false,
        projectId,
        current: 1,
        total: 1,
        phase: 'complete',
        projectIds: [projectId]
      })
      return snapshot
    } catch (err) {
      const hint = err instanceof Error ? err.message : 'sync failed'
      this.log(`[dashboard] sync failed (${project.name}): ${hint}`)
      const perChannel = await this.storedDeltas(project)
      const base = this.buildFallbackSnapshot(
        project,
        perChannel,
        await this.collectMessages(project)
      )
      base.syncState = 'error'
      base.mood = { state: 'neutral', signal: hint }
      this.lastResults.set(project.id, base)
      this.progress({
        syncing: false,
        projectId,
        current: 1,
        total: 1,
        phase: 'error',
        projectIds: [projectId],
        message: hint
      })
      return base
    }
  }

  async syncProjectSource(
    projectId: string,
    sourceId?: string
  ): Promise<{ channelsRead: number; newMessages: number; status: string; error?: string }> {
    this.scrapeQueueLength++
    if (this.scrapeQueueLength > 1) {
      this.scrapeEventListener?.({
        type: 'queued',
        queueLength: this.scrapeQueueLength - 1,
        text: `Scrape queued (${this.scrapeQueueLength - 1} ahead)`
      })
    }

    const task = async () => {
      try {
        return await this.executeSyncProjectSource(projectId, sourceId)
      } finally {
        this.scrapeQueueLength = Math.max(0, this.scrapeQueueLength - 1)
      }
    }

    // Chain sequentially to guarantee strict FIFO execution
    const execution = this.scrapeQueuePromise.then(task, task)
    this.scrapeQueuePromise = execution.catch(() => {})
    return execution
  }

  private async executeSyncProjectSource(
    projectId: string,
    sourceId?: string
  ): Promise<{ channelsRead: number; newMessages: number; status: string; error?: string }> {
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return { channelsRead: 0, newMessages: 0, status: 'error', error: 'Project not found' }

    const browserSources = (project.sources ?? []).filter(
      (s) => s.kind === 'browser' && s.enabled !== false && (!sourceId || s.id === sourceId)
    )

    if (browserSources.length === 0) {
      return { channelsRead: 0, newMessages: 0, status: 'error', error: 'No active browser sources found' }
    }

    let totalChannelsRead = 0
    let totalNewMessages = 0

    for (const bSrc of browserSources) {
      if (!bSrc.profileId || !bSrc.workspaceId) continue
      const startTime = Date.now()
      let channelsRead = 0
      let newMessagesCount = 0
      const snippets: { channelId: string; channelName?: string; sender: string; ts: string; snippet: string }[] = []
      let runStatus: 'connected' | 'challenge' | 'needs-login' | 'adapter-broken' | 'error' = 'connected'
      let runError: string | undefined = undefined

      const effectiveWorkspaceName = bSrc.workspaceName || bSrc.workspaceId

      try {
        const existingView =
          this.getExistingCardView?.(project.id, 'slack') ??
          this.getExistingBrowserView?.(bSrc.profileId, 'slack')
        const reader = new SlackReaderView({
          profileId: bSrc.profileId,
          projectId: project.id,
          workspaceId: bSrc.workspaceId,
          existingView: existingView ?? null,
          onEvent: (ev) => this.scrapeEventListener?.({ ...ev, workspaceName: effectiveWorkspaceName })
        })
        this.activeWatchReader = reader

        // Broadcast initial starting event
        this.scrapeEventListener?.({
          type: 'navigate',
          workspaceName: effectiveWorkspaceName,
          text: `Starting scrape for ${effectiveWorkspaceName}…`
        })

        // Auto-discover live channels from sidebar if not matching or requested
        let targetChannels = bSrc.channels
        try {
          const discovered = await reader.listChannels()
          if (discovered.length > 0) {
            // Preserve any user-toggled enabled states
            const existingMap = new Map((bSrc.channels ?? []).map((c) => [c.id, c.enabled]))
            const discoveredChannels = discovered.map((c) => ({
              id: c.id,
              name: c.name,
              isPrivate: c.isPrivate,
              // If user previously configured this channel, respect their choice; default to true
              enabled: existingMap.has(c.id) ? existingMap.get(c.id) : true
            }))

            // Persist discovered channels onto the source
            const updated = (project.sources ?? []).map((s) =>
              s.id === bSrc.id ? { ...s, channels: discoveredChannels } : s
            )
            void this.monitorStore.upsertProject({
              project: { ...project, sources: updated }
            })

            // Only scrape channels that are enabled (enabled !== false)
            targetChannels = discoveredChannels.filter((c) => c.enabled !== false)
          } else {
            targetChannels = (bSrc.channels ?? []).filter((c) => c.enabled !== false)
          }
        } catch {
          // fallback to original list, filtering for enabled
          targetChannels = (bSrc.channels ?? []).filter((c) => c.enabled !== false)
        }

        const totalChannels = targetChannels.length
        let channelIndex = 0

        for (const ch of targetChannels) {
          channelIndex++
          this.scrapeEventListener?.({
            type: 'navigate',
            workspaceName: effectiveWorkspaceName,
            channelName: ch.name || ch.id,
            scrollIndex: channelIndex,
            maxScroll: totalChannels,
            messageCount: newMessagesCount,
            text: `Reading #${ch.name || ch.id} (${channelIndex}/${totalChannels})…`
          })

          // Calculate 5-minute safety overlap cursor from DeltaStore
          let overlapCursorTs = 0
          try {
            const existingDelta = await this.deltaStore.load(bSrc.profileId, bSrc.workspaceId, ch.id)
            if (existingDelta?.cursor) {
              const numericCursor = parseFloat(existingDelta.cursor)
              if (!Number.isNaN(numericCursor) && numericCursor > 0) {
                // 5 minutes = 300 seconds safety buffer
                overlapCursorTs = Math.max(0, numericCursor - 300)
              }
            }
          } catch {
            // ignore
          }

          const rawScraped = await reader.readChannelMessages(ch.id)
          channelsRead++

          // Filter against overlapCursorTs if present (ensures we re-evaluate past 5 min for boundary messages)
          const messages = overlapCursorTs > 0
            ? rawScraped.filter((m) => {
                const nTs = parseFloat(m.ts)
                return Number.isNaN(nTs) || nTs >= overlapCursorTs
              })
            : rawScraped

          if (messages.length > 0) {
            const appendRes = await this.deltaStore.appendMessages({
              profileId: bSrc.profileId,
              teamId: bSrc.workspaceId,
              channelId: ch.id,
              channelName: ch.name,
              messages,
              source: 'client'
            })
            newMessagesCount += appendRes.added
            for (const m of messages.slice(-5)) {
              snippets.push({
                channelId: ch.id,
                channelName: ch.name,
                sender: m.user || 'Anonymous',
                ts: m.ts,
                snippet: (m.text || '').slice(0, 100)
              })
            }
          }
        }
        reader.destroy()
        if (this.activeWatchReader === reader) {
          this.activeWatchReader = null
        }
        totalChannelsRead += channelsRead
        totalNewMessages += newMessagesCount

        const nowIso = new Date().toISOString()
        const updatedSources = (project.sources ?? []).map((s) =>
          s.id === bSrc.id
            ? {
                ...s,
                status: 'connected' as const,
                lastReadAt: nowIso,
                lastReadNewCount: newMessagesCount
              }
            : s
        )
        await this.monitorStore.upsertProject({
          project: {
            ...project,
            sources: updatedSources
          }
        })
      } catch (err: any) {
        runStatus = 'error'
        runError = err instanceof Error ? err.message : String(err)
        this.log(`[dashboard] manual scrape source ${bSrc.id} error: ${runError}`)
      } finally {
        if (this.activeWatchReader) {
          this.activeWatchReader.destroy()
          this.activeWatchReader = null
        }
        // Guaranteed audit log write - runs on EVERY scrape attempt (success, 0 messages, or error)
        try {
          const runLogStore = new RunLogStore({ rootDir: this.deltaStore.rootDir })
          await runLogStore.append({
            runId: `run-${Date.now().toString(36)}`,
            ts: new Date().toISOString(),
            trigger: 'manual',
            projectId: project.id,
            sourceId: bSrc.id,
            sourceKind: 'browser',
            workspaceId: bSrc.workspaceId,
            channelsRead,
            newMessages: newMessagesCount,
            snippets: snippets.slice(0, 20),
            durationMs: Date.now() - startTime,
            llmCalls: 0,
            status: runStatus === 'error' ? 'adapter-broken' : runStatus,
            errorCode: runError
          })
        } catch {
          // ignore log write failure
        }

        // Emit final run completion event so buttons never stay stuck in "Scraping..."
        this.scrapeEventListener?.({
          type: 'run_finished',
          workspaceName: effectiveWorkspaceName,
          channelName: bSrc.workspaceId,
          messageCount: newMessagesCount,
          text: runError
            ? `Scrape stopped: ${runError}`
            : `Scraped ${channelsRead} channels. ${newMessagesCount} new messages captured.`
        })
      }
    }

    return {
      channelsRead: totalChannelsRead,
      newMessages: totalNewMessages,
      status: 'success'
    }
  }

  async syncAll(): Promise<DashboardProjectSnapshot[]> {
    const projects = await this.monitorStore.listProjects()
    const results: DashboardProjectSnapshot[] = []
    // One cache per cycle: cards watching the same channel share the page fetch.
    const historyCache: CycleHistoryCache = new Map()
    for (const project of projects) {
      const snap = await this.syncProject(project.id, historyCache)
      if (snap) results.push(snap)
    }
    try {
      this.onSynced?.(results)
    } catch (err) {
      this.logInfo(`[dashboard] post-sync hook failed: ${String(err)}`)
    }
    return results
  }

  /** Snapshot straight from stored data (no network). */
  async buildSnapshot(projectId?: string): Promise<DashboardProjectSnapshot[]> {
    const projects = await this.monitorStore.listProjects()
    const target = projectId ? projects.filter((p) => p.id === projectId) : projects
    const out: DashboardProjectSnapshot[] = []
    for (const project of target) {
      const cached = this.lastResults.get(project.id)
      if (cached) {
        // the cached snapshot may predate the latest insight (the enrich
        // step runs after the cache is written) — always refresh it. The
        // project record can also change (dates, completion, channels), so
        // re-derive the fields that depend on it.
        const refreshed: DashboardProjectSnapshot = {
          ...cached,
          project,
          effectiveDates: {
            startDate: project.startDate ?? cached.extractedDates?.startDate,
            endDate: project.endDate ?? cached.extractedDates?.endDate
          },
          completion: project.manualCompletion ?? cached.completion
        }
        out.push(await this.finishSnapshot(project, refreshed))
        continue
      }
      const perChannel = await this.storedDeltas(project)
      // cold start: summarize what is ALREADY stored, so the card is never
      // blank while waiting for the first network sync
      const messages = await this.collectMessages(project)
      const snapshot = this.buildFallbackSnapshot(project, perChannel, messages)
      out.push(await this.finishSnapshot(project, snapshot))
    }
    return out
  }

  /** Attach the stored insight, then the deterministic Dashboard metrics. */
  private async finishSnapshot(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardProjectSnapshot> {
    const withInsight = await this.attachLastInsight(project, snapshot)
    try {
      withInsight.metrics = await this.metricsFor(project, withInsight)
    } catch (err) {
      // A metrics failure must never blank a card; it keeps the last values.
      this.logInfo(`[dashboard] metrics failed for ${project.name}: ${String(err)}`)
    }
    return withInsight
  }

  /**
   * Build (or reuse) the Dashboard metrics. The expensive part reads the stored
   * channel files, so it is cached until a sync, an insight refresh, a project
   * edit, or a new visit marker changes the inputs.
   */
  private async metricsFor(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardMetrics> {
    const history = this.historyReader ? await this.historyReader(project.id) : []
    const lastViewedAt = this.viewedStore ? await this.viewedStore.get(project.id) : null
    const key = [
      snapshot.lastUpdatedAt ?? '',
      snapshot.totalMessageCount ?? 0,
      snapshot.insightUpdatedAt ?? '',
      snapshot.insight?.status ?? '',
      snapshot.insight?.progress ?? '',
      project.manualCompletion ?? '',
      project.startDate ?? '',
      project.endDate ?? '',
      history.length,
      history[0]?.atIso ?? '',
      lastViewedAt ?? ''
    ].join('|')
    const cached = this.metricsCache.get(project.id)
    if (cached && cached.key === key) return cached.value

    const messages = await this.collectMessages(project)
    const value = computeMetrics({
      project,
      messages,
      insight: snapshot.insight ?? null,
      history,
      lastViewedAt
    })
    this.metricsCache.set(project.id, { key, value })
    return value
  }

  /** v2.3 — the AI insight is shown even before the first sync of the session. */
  private async attachLastInsight(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot
  ): Promise<DashboardProjectSnapshot> {
    if (!this.insightReader) return snapshot
    try {
      const insight = await this.insightReader.getLastInsight(project.id)
      if (!insight) return snapshot
      const entry = await this.insightReader.getLastEntry(project.id)
      return {
        ...snapshot,
        insight,
        insightUpdatedAt: entry?.atIso ?? null,
        insightSource: entry?.source ?? null,
        insightModel: entry?.model ?? null
      }
    } catch (err) {
      this.logInfo(
        `[dashboard] could not load the stored insight for ${project.name}: ${String(err)}`
      )
      return snapshot
    }
  }

  /** how many messages the last sync added (activity signal for the feed) */
  newMessageCountFor(projectId: string): number {
    return this.lastResults.get(projectId)?.newMessageCount ?? 0
  }

  private async storedDeltas(project: DashboardProject): Promise<DashboardChannelDelta[]> {
    const { workspaces } = await this.storedWorkspaces(project)
    const out: DashboardChannelDelta[] = []

    for (const workspace of workspaces) {
      for (const monitor of workspace.monitors) {
        const d = await this.deltaStore.load(
          workspace.profileId,
          workspace.teamId,
          monitor.channelId
        )
        if (d) out.push(this.perChannelDelta(d, workspace.source))
      }
    }
    return out
  }

  private buildFallbackSnapshot(
    project: DashboardProject,
    perChannel: DashboardChannelDelta[],
    messages: DashboardStoredMessage[] = []
  ): DashboardProjectSnapshot {
    return summarizeProject({
      project,
      messages,
      netNewCount: 0,
      perChannel,
      lastUpdatedAt: perChannel[0]?.lastSyncAt ?? null
    })
  }

  private async collectMessages(project: DashboardProject): Promise<DashboardStoredMessage[]> {
    const { workspaces } = await this.storedWorkspaces(project)
    const out: DashboardStoredMessage[] = []
    for (const workspace of workspaces) {
      for (const monitor of workspace.monitors) {
        const messages = await this.deltaStore.messagesSince(
          workspace.profileId,
          workspace.teamId,
          monitor.channelId
        )
        for (const message of messages) {
          out.push(message.source ? message : { ...message, source: workspace.source })
        }
      }
    }
    return out
  }
}

/**
 * v2.2 subclass — identical behavior plus an optional post-sync insight
 * refresh (NVIDIA NIM). Additive: base engine stays untouched.
 */
export class DashboardInsightSyncEngine extends DashboardSyncEngine {
  private insightEngine: InsightEngine | null

  constructor(deps: DashboardSyncEngineDeps & { insightEngine?: InsightEngine | null }) {
    super(deps)
    if (deps.insightEngine) {
      this.insightEngine = deps.insightEngine
    } else {
      this.insightEngine = null
    }
  }

  /** attach insights later (e.g. after env key detected) */
  setInsightEngine(engine: InsightEngine | null): void {
    this.insightEngine = engine
  }

  private async enrich(
    project: DashboardProject,
    snapshot: DashboardProjectSnapshot,
    token: string
  ): Promise<DashboardProjectSnapshot> {
    if (!this.insightEngine) return snapshot
    try {
      return await this.insightEngine.refresh(project, token, snapshot)
    } catch {
      return snapshot
    }
  }

  override async syncProject(
    projectId: string,
    historyCache?: CycleHistoryCache
  ): Promise<DashboardProjectSnapshot | null> {
    const snapshot = await super.syncProject(projectId, historyCache)
    if (!snapshot || !this.insightEngine) return snapshot
    const projects = await this.monitorStore.listProjects()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return snapshot
    const token = await this.tokenFor(project)
    if (!token) {
      this.logInfo(`[dashboard] no token for ${project.name} — insight refresh skipped`)
      return snapshot
    }
    return await this.enrich(project, snapshot, token)
  }
}
