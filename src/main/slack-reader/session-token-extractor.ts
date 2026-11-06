import type { WebContentsView } from 'electron'
import { log } from '../logging'

export interface SlackSessionCredentials {
  /** Client token starting with xoxc- */
  token: string
  /** Session cookie d starting with xoxd- */
  cookie: string
}

/**
 * Passive in-memory script to read the xoxc client token from Slack Web's JavaScript state.
 * Performs zero network requests and zero typing.
 */
export const EXTRACT_TOKEN_SCRIPT = `
(function() {
  try {
    // 1. Check official boot_data
    if (window.boot_data && window.boot_data.api_token && typeof window.boot_data.api_token === 'string') {
      if (window.boot_data.api_token.startsWith('xoxc-')) {
        return window.boot_data.api_token;
      }
    }
    // 2. Check TS global model
    if (window.TS && window.TS.boot_data && window.TS.boot_data.api_token && typeof window.TS.boot_data.api_token === 'string') {
      if (window.TS.boot_data.api_token.startsWith('xoxc-')) {
        return window.TS.boot_data.api_token;
      }
    }
    // 3. Inspect localStorage localConfig_v2 for client token
    const localRaw = localStorage.getItem('localConfig_v2');
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      const teams = parsed.teams || {};
      for (const t of Object.values(teams)) {
        const teamObj = t as any;
        if (teamObj && typeof teamObj.token === 'string' && teamObj.token.startsWith('xoxc-')) {
          return teamObj.token;
        }
      }
    }
    // 4. Inspect redux/TS models if exposed
    if (window.TS && window.TS.model && window.TS.model.api_token) {
      return String(window.TS.model.api_token);
    }
  } catch (_) {
    // ignore
  }
  return '';
})()
`

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export class SessionTokenExtractor {
  private readonly cache = new Map<string, { creds: SlackSessionCredentials; expiresAt: number }>()

  /**
   * Retrieves unexpired credentials from cache if available.
   */
  getCached(key: string): SlackSessionCredentials | null {
    if (!key) return null
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.creds
  }

  /**
   * Clears cached credentials (all or for a specific key).
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key)
    } else {
      this.cache.clear()
    }
  }

  /**
   * Caches valid credentials under a key.
   */
  setCached(key: string, creds: SlackSessionCredentials, ttlMs = DEFAULT_CACHE_TTL_MS): void {
    if (!key || !creds) return
    this.cache.set(key, { creds, expiresAt: Date.now() + ttlMs })
  }

  /**
   * Extracts xoxc token and xoxd session cookie from a WebContentsView or an array of candidate views.
   * Checks the cache first if cacheKey is provided.
   * Returns null if no candidate view yields valid credentials.
   */
  async extractSlackSessionTokens(
    viewOrViews: WebContentsView | null | (WebContentsView | null | undefined)[],
    cacheKey?: string
  ): Promise<SlackSessionCredentials | null> {
    if (cacheKey) {
      const cached = this.getCached(cacheKey)
      if (cached) {
        return cached
      }
    }

    const views = Array.isArray(viewOrViews) ? viewOrViews : [viewOrViews]

    for (const view of views) {
      if (!view || view.webContents?.isDestroyed()) continue

      try {
        const creds = await this.extractFromSingleView(view)
        if (creds) {
          if (cacheKey) {
            this.setCached(cacheKey, creds)
          }
          return creds
        }
      } catch (err) {
        log.info('[token-extractor] probe on view failed, trying next candidate:', {
          error: String(err)
        })
      }
    }

    return null
  }

  private async extractFromSingleView(
    view: WebContentsView
  ): Promise<SlackSessionCredentials | null> {
    // 1. Extract xoxd cookie from view partition
    const sessionObj = view.webContents.session
    if (!sessionObj?.cookies) return null

    const cookies = await sessionObj.cookies.get({ domain: '.slack.com', name: 'd' })
    let xoxdCookie = cookies.find((c) => c.name === 'd')?.value

    if (!xoxdCookie) {
      const allSlackCookies = await sessionObj.cookies.get({ url: 'https://app.slack.com' })
      xoxdCookie = allSlackCookies.find((c) => c.name === 'd')?.value
    }

    if (!xoxdCookie || !xoxdCookie.startsWith('xoxd-')) {
      return null
    }

    // 2. Extract xoxc token from the page context
    let xoxcToken = ''
    try {
      xoxcToken = (await view.webContents.executeJavaScript(
        EXTRACT_TOKEN_SCRIPT,
        true
      )) as string
    } catch {
      xoxcToken = ''
    }

    if (!xoxcToken || !xoxcToken.startsWith('xoxc-')) {
      return null
    }

    return {
      token: xoxcToken.trim(),
      cookie: xoxdCookie.trim()
    }
  }

  /**
   * Refreshes the session tokens by clearing the cache key and briefly re-probing candidate views.
   */
  async refreshSlackSessionTokens(
    viewOrViews: WebContentsView | null | (WebContentsView | null | undefined)[],
    cacheKey?: string
  ): Promise<SlackSessionCredentials | null> {
    if (cacheKey) this.clearCache(cacheKey)
    return this.extractSlackSessionTokens(viewOrViews, cacheKey)
  }
}

export const sessionTokenExtractor = new SessionTokenExtractor()
