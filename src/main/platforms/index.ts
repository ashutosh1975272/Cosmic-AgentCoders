/**
 * platforms/index.ts
 *
 * Bootstraps and registers all default platform suites into PlatformBackendRegistry.
 */

import { platformBackendRegistry } from './registry'
import { SlackPlatformSuite } from './slack/slack-platform-suite'
import { TeamsPlatformSuite } from './teams/teams-platform-suite'
import { WhatsAppPlatformSuite } from './whatsapp/whatsapp-platform-suite'

export function initializePlatformSuites(): void {
  if (!platformBackendRegistry.has('slack')) {
    platformBackendRegistry.register('slack', new SlackPlatformSuite())
  }
  if (!platformBackendRegistry.has('teams')) {
    platformBackendRegistry.register('teams', new TeamsPlatformSuite())
  }
  if (!platformBackendRegistry.has('whatsapp')) {
    platformBackendRegistry.register('whatsapp', new WhatsAppPlatformSuite())
  }
}

export { platformBackendRegistry }
