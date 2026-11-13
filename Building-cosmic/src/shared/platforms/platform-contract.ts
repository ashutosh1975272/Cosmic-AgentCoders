/**
 * platform-contract.ts
 *
 * Core contracts and interfaces for the Pluggable Multi-Platform Suite Architecture.
 * Allows Slack, Teams, WhatsApp, and up to 30+ future communication platforms
 * to plug in cleanly without modifying core engine or IPC router files.
 */

import type {
  DashboardChannelDelta,
  DashboardProject,
  ProjectSource,
  ProjectSourceChannel,
  ScrapeRunChannel,
  ScrapeRunMessageSnippet
} from '../dashboard-contract'

export type PlatformId = 'slack' | 'teams' | 'whatsapp' | string

export interface DiscoveredPlatformChannel {
  id: string
  name: string
  isPrivate: boolean
  isDm?: boolean
  kind: 'public' | 'private' | 'dm' | 'group-dm'
  memberCount?: number
  created?: number
  topic?: string
}

export interface PlatformMetadata {
  id: PlatformId
  displayName: string
  shortName: string
  icon: string
  defaultWorkspaceName: string
  supportedEngineModes: ('browser' | 'direct_api')[]
  supportsGoogleSso: boolean
  channelNounPlural: string // e.g. "Channels & DMs", "Teams & Chats", "Chats & Contacts"
  channelNounSingular: string // e.g. "Channel", "Chat", "Contact"
}

export interface PlatformDiscoveryContext {
  projectId?: string
  sourceId?: string
  profileId?: string
  workspaceId?: string
  existingView?: any | null
}

export interface PlatformDiscoveryResult {
  channels: DiscoveredPlatformChannel[]
  error?: string
}

export interface PlatformScrapeContext {
  project: DashboardProject
  source: ProjectSource
  targetChannels: ProjectSourceChannel[]
  deltaStore: any
  runId: string
  trigger: 'scheduled' | 'manual' | 'startup' | string
  signal?: AbortSignal
  existingView?: any | null
  onScrapeEvent?: (event: {
    type: 'read' | 'empty' | 'error' | 'step'
    runId: string
    projectId: string
    sourceId: string
    channelName?: string
    messageCount?: number
    text?: string
    error?: string
  }) => void
}

export interface PlatformScrapeResult {
  channels: ScrapeRunChannel[]
  newMessagesCount: number
  peopleCounts: Map<string, number>
  snippets: ScrapeRunMessageSnippet[]
  deltas: DashboardChannelDelta[]
  activeEngineMode: 'browser' | 'direct_api'
  channelErrors: number
  error?: string
}

export interface IPlatformBackendAdapter {
  readonly metadata: PlatformMetadata
  discoverChannels(ctx: PlatformDiscoveryContext): Promise<PlatformDiscoveryResult>
  scrapeChannels(ctx: PlatformScrapeContext): Promise<PlatformScrapeResult>
  dispose?(): void
}
