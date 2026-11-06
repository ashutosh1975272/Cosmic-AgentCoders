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

export class SessionTokenExtractor {
  /**
   * Extracts xoxc token and xoxd session cookie from a WebContentsView.
   * Returns null if the view is not logged in or credentials cannot be found.
   */
  async extractSlackSessionTokens(
    view: WebContentsView | null
  ): Promise<SlackSessionCredentials | null> {
    if (!view || view.webContents?.isDestroyed()) return null

    try {
      // 1. Extract xoxd cookie from view partition
      const cookies = await view.webContents.session.cookies.get({ domain: '.slack.com', name: 'd' })
      let xoxdCookie = cookies.find((c) => c.name === 'd')?.value

      if (!xoxdCookie) {
        // Fallback: check all slack cookies
        const allSlackCookies = await view.webContents.session.cookies.get({ url: 'https://app.slack.com' })
        xoxdCookie = allSlackCookies.find((c) => c.name === 'd')?.value
      }

      if (!xoxdCookie || !xoxdCookie.startsWith('xoxd-')) {
        log.info('[token-extractor] xoxd session cookie not found or invalid format')
        return null
      }

      // 2. Extract xoxc token from the page context
      const xoxcToken = (await view.webContents.executeJavaScript(
        EXTRACT_TOKEN_SCRIPT,
        true
      )) as string

      if (!xoxcToken || !xoxcToken.startsWith('xoxc-')) {
        log.info('[token-extractor] xoxc client token not found in DOM context')
        return null
      }

      return {
        token: xoxcToken.trim(),
        cookie: xoxdCookie.trim()
      }
    } catch (err) {
      log.info('[token-extractor] credential extraction failed:', { error: String(err) })
      return null
    }
  }

  /**
   * Refreshes the session tokens by briefly re-probing the view cookies and window state.
   */
  async refreshSlackSessionTokens(
    view: WebContentsView | null
  ): Promise<SlackSessionCredentials | null> {
    return this.extractSlackSessionTokens(view)
  }
}

export const sessionTokenExtractor = new SessionTokenExtractor()

