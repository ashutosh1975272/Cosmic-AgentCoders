/**
 * google-session-sync.ts
 *
 * Safely propagates Google authentication cookies from a profile's Electron
 * session partition into a card's dedicated session partition.
 *
 * Rule:  ONLY cookies belonging to Google identity/auth domains are copied.
 *        Slack, Teams, WhatsApp, and all other app cookies are NEVER touched.
 *
 * This allows cards to reuse the profile's Google sign-in for OAuth flows
 * (e.g. "Continue with Google" on slack.com) without leaking any app sessions
 * between cards.
 */

import { session as electronSession } from 'electron'
import { log } from '../logging'
import { partitionForProfile, partitionForCard } from './session-partition'
import type { AppId } from '../../shared/types'

/**
 * Domains that belong to Google identity / authentication.
 * Used for one-way profile → card cookie propagation.
 */
const GOOGLE_DOMAINS_RE =
  /(?:^|\.)(?:google\.com|google\.[a-z]{2,3}(?:\.[a-z]{2})?|accounts\.google\.com|googleusercontent\.com|gstatic\.com|youtube\.com|googleapis\.com)$/i

/**
 * Domains that must NEVER be copied across partitions.
 * Added as an explicit safeguard even though the whitelist above already
 * excludes them.
 */
const BLOCKED_DOMAINS_RE =
  /(?:^|\.)(?:slack\.com|slack-edge\.com|slackb\.com|microsoft\.com|microsoftonline\.com|live\.com|office\.com|office365\.com|teams\.microsoft\.com|whatsapp\.com|wa\.me|discord\.com|facebook\.com)$/i

/**
 * Returns true when `domain` belongs to a Google identity / auth service
 * and is safe to copy between partitions.
 */
export function isGoogleCookieDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  if (BLOCKED_DOMAINS_RE.test(host)) return false
  return GOOGLE_DOMAINS_RE.test(host)
}

/**
 * Copies only Google-domain cookies from a profile partition into a card
 * partition.  Never overwrites Slack, Teams, or WhatsApp cookies.
 *
 * Call this before activating a card's embed so that "Continue with Google"
 * flows inside the card already have an authenticated Google session.
 */
export async function syncGoogleSessionFromProfileToCard(
  profileId: string,
  projectId: string,
  appId: AppId | 'agentwork' = 'slack'
): Promise<number> {
  const srcAppId: AppId = appId === 'agentwork' ? 'slack' : appId
  const srcPartition = partitionForProfile(profileId, srcAppId)
  const dstPartition = partitionForCard(projectId, appId as AppId)

  if (srcPartition === dstPartition) return 0

  try {
    const srcSession = electronSession.fromPartition(srcPartition)
    const dstSession = electronSession.fromPartition(dstPartition)

    const allCookies = await srcSession.cookies.get({})
    const googleCookies = allCookies.filter((c) => isGoogleCookieDomain(c.domain ?? ''))

    if (googleCookies.length === 0) {
      log.debug('google-session-sync: no google cookies in profile partition', {
        profileId,
        projectId
      })
      return 0
    }

    let synced = 0
    for (const cookie of googleCookies) {
      const domain = cookie.domain ?? ''
      const host = domain.replace(/^\./, '')
      const scheme = cookie.secure ? 'https' : 'http'
      const url = `${scheme}://${host}${cookie.path || '/'}`

      const baseDetails = {
        url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        expirationDate: !cookie.session && (cookie.expirationDate ?? 0) > 0
          ? cookie.expirationDate
          : undefined,
        sameSite: (cookie.sameSite as 'no_restriction' | 'lax' | 'strict' | 'unspecified') ?? 'no_restriction'
      }

      try {
        await dstSession.cookies.set({
          ...baseDetails,
          domain: cookie.domain?.startsWith('.') ? cookie.domain : undefined
        })
        synced += 1
      } catch {
        try {
          await dstSession.cookies.set(baseDetails)
          synced += 1
        } catch (err) {
          log.warn('google-session-sync: skipped cookie', {
            name: cookie.name,
            domain: cookie.domain,
            err: String(err)
          })
        }
      }
    }

    await dstSession.cookies.flushStore()

    log.info('google-session-sync: google cookies synced profile → card', {
      profileId,
      projectId,
      appId,
      total: googleCookies.length,
      synced
    })

    return synced
  } catch (err) {
    log.warn('google-session-sync: sync failed', {
      profileId,
      projectId,
      err: String(err)
    })
    return 0
  }
}

/**
 * Propagates Google cookies from a profile to a list of card project IDs across all partitions
 * (Slack + AgentWork). Used after a successful profile-level Google login to bring all existing
 * cards under that profile up to date.
 */
export async function syncGoogleSessionToProfileCards(
  profileId: string,
  cardProjectIds: string[],
  appId?: AppId | 'agentwork'
): Promise<void> {
  if (cardProjectIds.length === 0) return

  const targets = appId ? [appId] : (['slack', 'agentwork'] as const)

  const results = await Promise.allSettled(
    cardProjectIds.flatMap((projectId) =>
      targets.map((target) => syncGoogleSessionFromProfileToCard(profileId, projectId, target))
    )
  )

  const synced = results.filter((r) => r.status === 'fulfilled').length
  log.info('google-session-sync: batch sync complete across card partitions', {
    profileId,
    total: cardProjectIds.length,
    synced
  })
}

/**
 * Synchronizes Google authentication cookies from a profile into all key partitions
 * of a project card (Slack, AgentWork, etc.) so that all tabs have immediate OAuth capability.
 */
export async function syncAllCardPartitionsFromProfile(
  profileId: string,
  projectId: string
): Promise<{ slack: number; agentwork: number }> {
  const [slack, agentwork] = await Promise.all([
    syncGoogleSessionFromProfileToCard(profileId, projectId, 'slack'),
    syncGoogleSessionFromProfileToCard(profileId, projectId, 'agentwork')
  ])
  return { slack, agentwork }
}

export interface CardGoogleSessionCheckResult {
  hasGoogleSession: boolean
  count: number
}

/**
 * Checks whether a card partition possesses valid Google authentication cookies.
 */
export async function checkCardGoogleSession(
  projectId: string,
  appId: AppId | 'agentwork' = 'agentwork'
): Promise<CardGoogleSessionCheckResult> {
  try {
    const partition = partitionForCard(projectId, appId as AppId)
    const ses = electronSession.fromPartition(partition)
    const cookies = await ses.cookies.get({})
    const googleCookies = cookies.filter((c) => isGoogleCookieDomain(c.domain ?? ''))

    // Critical authentication cookies: SID, SSID, HSID, __Secure-1PSID, etc.
    const hasAuthCookie = googleCookies.some(
      (c) => c.name === 'SID' || c.name === 'SSID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID'
    )

    return {
      hasGoogleSession: hasAuthCookie || googleCookies.length >= 5,
      count: googleCookies.length
    }
  } catch (err) {
    log.warn('checkCardGoogleSession failed', { projectId, appId, err: String(err) })
    return { hasGoogleSession: false, count: 0 }
  }
}


