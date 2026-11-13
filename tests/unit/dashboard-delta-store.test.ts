import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardDeltaStore } from '../../src/main/dashboard/delta-store'

const dirs: string[] = []

async function tmpStore(): Promise<DashboardDeltaStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-delta-'))
  dirs.push(dir)
  return new DashboardDeltaStore({ rootDir: dir })
}

const msg = (ts: string, text = 'hello'): { ts: string; user: string; text: string } => ({
  ts,
  user: 'U1',
  text
})

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true }).catch(() => {})))
  dirs.length = 0
})

describe('DashboardDeltaStore', () => {
  it('appends messages and returns cursor + counts', async () => {
    const store = await tmpStore()
    const res = await store.appendMessages({
      profileId: 'p1',
      teamId: 't1',
      channelId: 'c1',
      channelName: 'acme-dev',
      messages: [msg('100.0'), msg('200.0', 'second')]
    })
    expect(res.added).toBe(2)
    expect(res.cursor).toBe('200.0')
    const delta = await store.load('p1', 't1', 'c1')
    expect(delta?.channel.name).toBe('acme-dev')
    expect(delta?.messages).toHaveLength(2)
  })

  it('dedupes by ts and keeps ascending order', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('300.0', 'newer'), msg('100.0', 'older')]
    })
    const res = await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('100.0'), msg('200.0', 'mid')]
    })
    expect(res.added).toBe(1)
    const delta = await store.load('p', 't', 'c')
    expect(delta?.messages.map((m) => m.ts)).toEqual(['100.0', '200.0', '300.0'])
    expect(delta?.cursor).toBe('300.0')
  })

  it('tracks lastSyncAt and per-channel netNewCounts', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'p',
      teamId: 't',
      channelId: 'c',
      channelName: 'x',
      messages: [msg('100.0')]
    })
    const net = await store.getNetNewSinceCursor('p', 't', 'c', '100.0')
    expect(net.count).toBe(0)
    const snapshot = await store.readSnapshotMeta('p', 't', 'c1_notexist')
    expect(snapshot).toBeNull()
  })

  it('roundtrips a persisted file', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'pp',
      teamId: 'tt',
      channelId: 'cc',
      channelName: 'chan',
      messages: [msg('42.0', 'persisted')]
    })
    const raw = await readFile(join(store.rootDir, 'channels', 'pp', 'tt', 'cc.json'), 'utf8')
    expect(JSON.parse(raw).messages[0].ts).toBe('42.0')
  })

  it('lists all stored channel deltas for a profile', async () => {
    const store = await tmpStore()
    await store.appendMessages({
      profileId: 'px',
      teamId: 't1',
      channelId: 'ca',
      channelName: 'a',
      messages: [msg('1.0')]
    })
    await store.appendMessages({
      profileId: 'px',
      teamId: 't2',
      channelId: 'cb',
      channelName: 'b',
      messages: [msg('2.0')]
    })
    const all = await store.listForProfile('px')
    expect(all.map((d) => d.channel.id)).toEqual(['ca', 'cb'])
  })

  it('self-heals corrupted "ts": "NaN" and "cursor": "NaN" files on load, persisting clean JSON', async () => {
    const store = await tmpStore()
    const filePath = join(store.rootDir, 'channels', 'prof1', 'default', 'wa_talent_killer___.json')
    await mkdir(join(filePath, '..'), { recursive: true })

    const corruptedData = {
      channel: { id: 'wa_talent_killer___', name: 'Talent Killer 👿' },
      messages: [
        {
          ts: 'NaN',
          user: 'You',
          text: 'First corrupted message',
          source: 'ours'
        },
        {
          ts: 'NaN',
          user: 'You',
          text: 'Second corrupted message',
          source: 'ours'
        }
      ],
      cursor: 'NaN',
      lastSyncAt: '2026-11-13T14:12:59.393Z'
    }

    await writeFile(filePath, JSON.stringify(corruptedData), 'utf8')

    // Load should automatically repair the file
    const loaded = await store.load('prof1', 'default', 'wa_talent_killer___')
    expect(loaded).not.toBeNull()
    expect(loaded?.messages.length).toBe(2)
    expect(loaded?.messages[0].ts).not.toBe('NaN')
    expect(loaded?.messages[1].ts).not.toBe('NaN')
    expect(isNaN(Number(loaded?.messages[0].ts))).toBe(false)
    expect(isNaN(Number(loaded?.messages[1].ts))).toBe(false)
    expect(Number(loaded?.messages[0].ts)).toBeLessThan(Number(loaded?.messages[1].ts))
    expect(loaded?.cursor).toBe(loaded?.messages[1].ts)

    // Check that the file on disk was rewritten with clean JSON
    const diskContent = await readFile(filePath, 'utf8')
    const parsedDisk = JSON.parse(diskContent)
    expect(parsedDisk.cursor).toBe(loaded?.cursor)
    expect(parsedDisk.messages[0].ts).toBe(loaded?.messages[0].ts)
    expect(diskContent).not.toContain('"NaN"')
  })

  it('deduplicates messages on disk on load', async () => {
    const store = await tmpStore()
    const filePath = join(store.rootDir, 'channels', 'prof1', 't1', 'c_dup.json')
    await mkdir(join(filePath, '..'), { recursive: true })

    const dataWithDups = {
      channel: { id: 'c_dup', name: 'dup-chan' },
      messages: [
        { ts: '100.0', user: 'Alice', text: 'Hello' },
        { ts: '100.0', user: 'Alice', text: 'Hello' },
        { ts: '200.0', user: 'Bob', text: 'World' }
      ],
      cursor: '200.0',
      lastSyncAt: '2026-11-13T14:00:00.000Z'
    }
    await writeFile(filePath, JSON.stringify(dataWithDups), 'utf8')

    const loaded = await store.load('prof1', 't1', 'c_dup')
    expect(loaded?.messages).toHaveLength(2)
    expect(loaded?.messages.map((m) => m.ts)).toEqual(['100.0', '200.0'])

    const diskContent = await readFile(filePath, 'utf8')
    const parsedDisk = JSON.parse(diskContent)
    expect(parsedDisk.messages).toHaveLength(2)
  })
})
