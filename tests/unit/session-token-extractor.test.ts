import { describe, it, expect, vi } from 'vitest'
import {
  SessionTokenExtractor,
  EXTRACT_TOKEN_SCRIPT
} from '../../src/main/slack-reader/session-token-extractor'

describe('SessionTokenExtractor', () => {
  it('extracts valid xoxc and xoxd credentials', async () => {
    const extractor = new SessionTokenExtractor()

    const mockView = {
      webContents: {
        isDestroyed: () => false,
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([
              { name: 'd', value: 'xoxd-1234567890abcdef1234567890abcdef' }
            ])
          }
        },
        executeJavaScript: vi.fn().mockResolvedValue('xoxc-9876543210-abcdef')
      }
    } as any

    const result = await extractor.extractSlackSessionTokens(mockView)
    expect(result).not.toBeNull()
    expect(result?.token).toBe('xoxc-9876543210-abcdef')
    expect(result?.cookie).toBe('xoxd-1234567890abcdef1234567890abcdef')
  })

  it('returns null if xoxd cookie is missing', async () => {
    const extractor = new SessionTokenExtractor()

    const mockView = {
      webContents: {
        isDestroyed: () => false,
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([])
          }
        },
        executeJavaScript: vi.fn().mockResolvedValue('xoxc-9876543210-abcdef')
      }
    } as any

    const result = await extractor.extractSlackSessionTokens(mockView)
    expect(result).toBeNull()
  })

  it('returns null if xoxc token is missing or not prefixed with xoxc-', async () => {
    const extractor = new SessionTokenExtractor()

    const mockView = {
      webContents: {
        isDestroyed: () => false,
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([
              { name: 'd', value: 'xoxd-1234567890abcdef1234567890abcdef' }
            ])
          }
        },
        executeJavaScript: vi.fn().mockResolvedValue('')
      }
    } as any

    const result = await extractor.extractSlackSessionTokens(mockView)
    expect(result).toBeNull()
  })

  it('handles destroyed webContents gracefully', async () => {
    const extractor = new SessionTokenExtractor()

    const mockView = {
      webContents: {
        isDestroyed: () => true
      }
    } as any

    const result = await extractor.extractSlackSessionTokens(mockView)
    expect(result).toBeNull()
  })

  it('contains expected detection keys in EXTRACT_TOKEN_SCRIPT', () => {
    expect(EXTRACT_TOKEN_SCRIPT).toContain('window.boot_data')
    expect(EXTRACT_TOKEN_SCRIPT).toContain('window.TS')
    expect(EXTRACT_TOKEN_SCRIPT).toContain('localConfig_v2')
  })
})

