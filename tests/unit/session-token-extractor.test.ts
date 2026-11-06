import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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

  it('iterates through candidate views until valid credentials are found', async () => {
    const extractor = new SessionTokenExtractor()

    const blankView = {
      webContents: {
        isDestroyed: () => false,
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        executeJavaScript: vi.fn().mockResolvedValue('')
      }
    } as any

    const liveView = {
      webContents: {
        isDestroyed: () => false,
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([
              { name: 'd', value: 'xoxd-live-cookie-123' }
            ])
          }
        },
        executeJavaScript: vi.fn().mockResolvedValue('xoxc-live-token-456')
      }
    } as any

    const result = await extractor.extractSlackSessionTokens([blankView, liveView])
    expect(result).not.toBeNull()
    expect(result?.token).toBe('xoxc-live-token-456')
    expect(result?.cookie).toBe('xoxd-live-cookie-123')
  })

  it('uses cached credentials on subsequent calls with cacheKey', async () => {
    const extractor = new SessionTokenExtractor()

    const mockView = {
      webContents: {
        isDestroyed: () => false,
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([
              { name: 'd', value: 'xoxd-cached-cookie-123' }
            ])
          }
        },
        executeJavaScript: vi.fn().mockResolvedValue('xoxc-cached-token-456')
      }
    } as any

    const res1 = await extractor.extractSlackSessionTokens(mockView, 'proj-123')
    expect(res1?.token).toBe('xoxc-cached-token-456')
    expect(mockView.webContents.executeJavaScript).toHaveBeenCalledTimes(1)

    // Second call with destroyed/empty view must return cached result
    const res2 = await extractor.extractSlackSessionTokens(null, 'proj-123')
    expect(res2?.token).toBe('xoxc-cached-token-456')
    expect(mockView.webContents.executeJavaScript).toHaveBeenCalledTimes(1)

    // Clear cache
    extractor.clearCache('proj-123')
    const res3 = await extractor.extractSlackSessionTokens(null, 'proj-123')
    expect(res3).toBeNull()
  })

  it('contains expected detection keys in EXTRACT_TOKEN_SCRIPT', () => {
    expect(EXTRACT_TOKEN_SCRIPT).toContain('window.boot_data')
    expect(EXTRACT_TOKEN_SCRIPT).toContain('window.TS')
    expect(EXTRACT_TOKEN_SCRIPT).toContain('localConfig_v2')
  })

  it('extracts tokens directly from partition disk storage when views are missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-test-'))
    const partDir = path.join(tmpDir, 'Partitions', 'card-p1')
    const ldbDir = path.join(partDir, 'Local Storage', 'leveldb')
    fs.mkdirSync(ldbDir, { recursive: true })

    const sampleToken = 'xoxc-disk-token-1234567890abcdef1234567890abcdef1234567890abcdef'
    const sampleCookie = 'xoxd-disk-cookie-1234567890abcdef1234567890abcdef1234567890abcdef'

    fs.writeFileSync(path.join(ldbDir, '000001.ldb'), `some_binary_data_${sampleToken}\x00end`)
    fs.writeFileSync(path.join(partDir, 'Cookies'), `sqlite_header_${sampleCookie}\x00cookie_end`)

    const extractor = new SessionTokenExtractor()
    const diskRes = extractor.extractFromPartitionDisk('persist:card-p1', tmpDir)
    expect(diskRes).not.toBeNull()
    expect(diskRes?.token).toBe(sampleToken)
    expect(diskRes?.cookie).toBe(sampleCookie)

    // Verify extractSlackSessionTokens falls back to partition disk storage and caches result
    const fullRes = await extractor.extractSlackSessionTokens([], 'test-cache-key', {
      partitions: ['persist:card-p1'],
      userDataDir: tmpDir
    })
    expect(fullRes).not.toBeNull()
    expect(fullRes?.token).toBe(sampleToken)
    expect(fullRes?.cookie).toBe(sampleCookie)

    // Cached call with no partitions returns cached credentials
    const cachedRes = await extractor.extractSlackSessionTokens([], 'test-cache-key')
    expect(cachedRes?.token).toBe(sampleToken)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})


