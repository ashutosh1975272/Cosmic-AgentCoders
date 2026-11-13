import { describe, it, expect, beforeEach } from 'vitest'
import { PlatformBackendRegistry } from '../../src/main/platforms/registry'
import type {
  IPlatformBackendAdapter,
  PlatformMetadata,
  PlatformDiscoveryContext,
  PlatformDiscoveryResult,
  PlatformScrapeContext,
  PlatformScrapeResult
} from '../../src/shared/platforms/platform-contract'

class MockDiscordSuite implements IPlatformBackendAdapter {
  readonly metadata: PlatformMetadata = {
    id: 'discord',
    displayName: 'Discord Server',
    shortName: 'Discord',
    icon: 'discord',
    defaultWorkspaceName: 'Discord Server',
    supportedEngineModes: ['browser'],
    supportsGoogleSso: false,
    channelNounPlural: 'Channels & DMs',
    channelNounSingular: 'Channel'
  }

  async discoverChannels(_ctx: PlatformDiscoveryContext): Promise<PlatformDiscoveryResult> {
    return {
      channels: [
        { id: 'disc-general', name: 'general', isPrivate: false, isDm: false, kind: 'public' }
      ]
    }
  }

  async scrapeChannels(_ctx: PlatformScrapeContext): Promise<PlatformScrapeResult> {
    return {
      channels: [],
      newMessagesCount: 0,
      peopleCounts: new Map(),
      snippets: [],
      deltas: [],
      activeEngineMode: 'browser',
      channelErrors: 0
    }
  }
}

describe('PlatformBackendRegistry Pluggable Architecture', () => {
  let registry: PlatformBackendRegistry

  beforeEach(() => {
    registry = new PlatformBackendRegistry()
    registry.registerDefaultSuites()
  })

  it('initializes with default suites: slack, teams, whatsapp', () => {
    expect(registry.has('slack')).toBe(true)
    expect(registry.has('teams')).toBe(true)
    expect(registry.has('whatsapp')).toBe(true)

    const list = registry.list()
    expect(list.map((m) => m.id)).toEqual(expect.arrayContaining(['slack', 'teams', 'whatsapp']))
  })

  it('retrieves adapters by exact name and case-insensitively', () => {
    const slack = registry.get('slack')
    expect(slack.metadata.displayName).toBe('Slack Workspace')

    const teams = registry.get('TEAMS')
    expect(teams.metadata.displayName).toBe('Microsoft Teams')

    const wa = registry.get('WhatsApp')
    expect(wa.metadata.displayName).toBe('WhatsApp Web')
  })

  it('allows plugging in a 4th or 30th platform without modifying core code', async () => {
    const discordSuite = new MockDiscordSuite()
    registry.register('discord', discordSuite)

    expect(registry.has('discord')).toBe(true)
    const retrieved = registry.get('discord')
    expect(retrieved.metadata.displayName).toBe('Discord Server')

    const discovery = await retrieved.discoverChannels({ sourceId: 'src-1' })
    expect(discovery.channels).toHaveLength(1)
    expect(discovery.channels[0].name).toBe('general')
  })

  it('throws descriptive error if an unknown platform is requested and no fallback exists', () => {
    registry.clear()
    expect(() => registry.get('unregistered_platform')).toThrow(
      'No adapter registered for platform: "unregistered_platform"'
    )
  })
})
