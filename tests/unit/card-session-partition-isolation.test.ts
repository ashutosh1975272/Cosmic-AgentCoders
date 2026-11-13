// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { partitionForCard, partitionForProfile } from '../../src/main/profiles/session-partition'
import { isGoogleCookieDomain, syncGoogleSessionFromProfileToCard } from '../../src/main/profiles/google-session-sync'

type FakeCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  expirationDate?: number
  sameSite?: string
}

const partitionStores = new Map<string, FakeCookie[]>()

function getStore(partition: string): FakeCookie[] {
  if (!partitionStores.has(partition)) partitionStores.set(partition, [])
  return partitionStores.get(partition)!
}

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => ({
      cookies: {
        get: async (filter?: Record<string, unknown>) => {
          const store = getStore(partition)
          if (!filter || Object.keys(filter).length === 0) return [...store]
          if (filter.domain) {
            return store.filter((c) => c.domain.includes(filter.domain as string))
          }
          return [...store]
        },
        set: async (cookie: FakeCookie) => {
          const store = getStore(partition)
          const idx = store.findIndex(
            (c) => c.name === cookie.name && c.domain === cookie.domain
          )
          if (idx >= 0) {
            store[idx] = cookie
          } else {
            store.push(cookie)
          }
        },
        flushStore: async () => {}
      }
    })
  }
}))

describe('Card Session Partition Isolation', () => {
  beforeEach(() => {
    partitionStores.clear()
  })

  it('generates distinct partition names for card vs profile for all platforms', () => {
    const projectId = 'proj-123'
    const profileId = 'prof-456'

    for (const appId of ['slack', 'teams', 'whatsapp'] as const) {
      const cardPart = partitionForCard(projectId, appId)
      const profilePart = partitionForProfile(profileId, appId)

      expect(cardPart).toBe(`persist:card-${projectId}-${appId}`)
      expect(profilePart).toBe(`persist:profile-${profileId}-${appId}`)
      expect(cardPart).not.toBe(profilePart)
    }
  })

  it('only propagates Google SSO cookies to card partitions, strictly blocking Teams, WhatsApp, and Slack', async () => {
    const projectId = 'proj-alpha'
    const profileId = 'prof-ashutosh'
    const profilePartition = partitionForProfile(profileId, 'teams')
    const cardPartition = partitionForCard(projectId, 'teams')

    // Seed profile partition with a mix of Google auth, Microsoft Teams tokens, and other cookies
    const profileStore = getStore(profilePartition)
    profileStore.push(
      { name: 'SID', value: 'google-sid-token', domain: '.google.com', path: '/' },
      { name: 'HSID', value: 'google-hsid-token', domain: '.google.com', path: '/' },
      { name: 'ESTSAUTH', value: 'ms-secret-teams-auth', domain: '.login.microsoftonline.com', path: '/' },
      { name: 'authtoken', value: 'teams-bearer-token', domain: '.teams.microsoft.com', path: '/' },
      { name: 'wa_ul', value: 'whatsapp-token', domain: '.whatsapp.com', path: '/' },
      { name: 'd', value: 'slack-xoxd-token', domain: '.slack.com', path: '/' }
    )

    // Execute session sync
    const synced = await syncGoogleSessionFromProfileToCard(profileId, projectId, 'teams')

    expect(synced).toBe(2) // Only SID and HSID
    const cardStore = getStore(cardPartition)
    const cardCookieNames = cardStore.map((c) => c.name)

    // Google cookies transferred
    expect(cardCookieNames).toContain('SID')
    expect(cardCookieNames).toContain('HSID')

    // Microsoft Teams, Slack, WhatsApp cookies must NOT be in the card partition
    expect(cardCookieNames).not.toContain('ESTSAUTH')
    expect(cardCookieNames).not.toContain('authtoken')
    expect(cardCookieNames).not.toContain('wa_ul')
    expect(cardCookieNames).not.toContain('d')

    // Domain filter checks
    expect(isGoogleCookieDomain('.google.com')).toBe(true)
    expect(isGoogleCookieDomain('accounts.google.com')).toBe(true)
    expect(isGoogleCookieDomain('.login.microsoftonline.com')).toBe(false)
    expect(isGoogleCookieDomain('.teams.microsoft.com')).toBe(false)
    expect(isGoogleCookieDomain('.whatsapp.com')).toBe(false)
    expect(isGoogleCookieDomain('.slack.com')).toBe(false)
  })

  it('ensures card partition auth does not bleed into profile partition', async () => {
    const projectId = 'proj-isolated'
    const profileId = 'prof-isolated'
    const cardPart = partitionForCard(projectId, 'teams')
    const profilePart = partitionForProfile(profileId, 'teams')

    // Log into Teams in the card partition
    const cardStore = getStore(cardPart)
    cardStore.push({
      name: 'ESTSAUTH',
      value: 'card-user-ms-token',
      domain: '.login.microsoftonline.com',
      path: '/'
    })

    // Profile partition must remain completely empty (no bleed)
    const profileStore = getStore(profilePart)
    expect(profileStore).toHaveLength(0)
  })
})
