/**
 * registry.ts
 *
 * Central registry for backend platform suites (Slack, Teams, WhatsApp, etc.).
 * Coordinates platform-agnostic channel discovery and message ingestion.
 */

import type {
  PlatformId,
  PlatformMetadata,
  IPlatformBackendAdapter
} from '../../shared/platforms/platform-contract'
import { SlackPlatformSuite } from './slack/slack-platform-suite'
import { TeamsPlatformSuite } from './teams/teams-platform-suite'
import { WhatsAppPlatformSuite } from './whatsapp/whatsapp-platform-suite'
import { log } from '../logging'

export class PlatformBackendRegistry {
  private static instance: PlatformBackendRegistry | null = null
  private adapters = new Map<string, IPlatformBackendAdapter>()

  public static getInstance(): PlatformBackendRegistry {
    if (!PlatformBackendRegistry.instance) {
      PlatformBackendRegistry.instance = new PlatformBackendRegistry()
      PlatformBackendRegistry.instance.registerDefaultSuites()
    }
    return PlatformBackendRegistry.instance
  }

  public registerDefaultSuites(): void {
    if (!this.adapters.has('slack')) {
      this.adapters.set('slack', new SlackPlatformSuite())
    }
    if (!this.adapters.has('teams')) {
      this.adapters.set('teams', new TeamsPlatformSuite())
    }
    if (!this.adapters.has('whatsapp')) {
      this.adapters.set('whatsapp', new WhatsAppPlatformSuite())
    }
  }

  /** Register a platform suite adapter */
  public register(platformId: PlatformId, adapter: IPlatformBackendAdapter): void {
    const key = platformId.toLowerCase()
    this.adapters.set(key, adapter)
    log.info(`[PlatformRegistry] Registered platform suite: ${key} (${adapter.metadata.displayName})`)
  }

  /** Check if a platform adapter is registered */
  public has(platformId: PlatformId): boolean {
    return this.adapters.has(platformId.toLowerCase())
  }

  /** Get registered platform adapter with fallback */
  public get(platformId: PlatformId): IPlatformBackendAdapter {
    const key = platformId.toLowerCase()
    const adapter = this.adapters.get(key)
    if (adapter) return adapter

    // Fallback: Check if key matches an existing adapter or default to slack
    if (key.includes('teams') && this.adapters.has('teams')) {
      return this.adapters.get('teams')!
    }
    if (key.includes('whatsapp') && this.adapters.has('whatsapp')) {
      return this.adapters.get('whatsapp')!
    }
    if (this.adapters.has('slack')) {
      return this.adapters.get('slack')!
    }

    throw new Error(`[PlatformRegistry] No adapter registered for platform: "${platformId}"`)
  }

  /** List all registered platforms metadata */
  public list(): PlatformMetadata[] {
    return Array.from(this.adapters.values()).map((a) => a.metadata)
  }

  /** Clear all registered adapters (useful for unit tests) */
  public clear(): void {
    this.adapters.clear()
  }
}

export const platformBackendRegistry = PlatformBackendRegistry.getInstance()
