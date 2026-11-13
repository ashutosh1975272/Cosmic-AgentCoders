import { describe, it, expect, vi } from 'vitest'
import { BrowserViewManager } from '../../src/main/profiles/browser-view-manager'

describe('BrowserViewManager Embed Lifecycle', () => {
  it('resets embedHidden to false and attaches view upon activateCardSlackEmbed', async () => {
    const bvm = new BrowserViewManager()

    // Simulate embed hidden from previous modal or card toggle
    const children: any[] = []
    const mockWindow = {
      contentView: {
        children,
        addChildView: vi.fn((v: any) => {
          children.push(v)
        }),
        removeChildView: vi.fn((v: any) => {
          const idx = children.indexOf(v)
          if (idx !== -1) children.splice(idx, 1)
        })
      }
    } as any

    bvm.setEmbedVisible(mockWindow, false)
    expect((bvm as any).embedHidden).toBe(true)

    // Create mock view
    const mockView = {
      webContents: {
        getURL: vi.fn().mockReturnValue('https://web.whatsapp.com'),
        loadURL: vi.fn().mockResolvedValue(undefined),
        isDestroyed: vi.fn().mockReturnValue(false)
      },
      setBounds: vi.fn()
    } as any
    ;(bvm as any).views.set('card:p1:whatsapp', mockView)
    vi.spyOn(bvm as any, 'getOrCreateCardView').mockReturnValue(mockView)

    await bvm.activateCardSlackEmbed(
      'prof-1',
      '',
      mockWindow,
      { x: 100, y: 100, width: 800, height: 600 },
      'whatsapp',
      'p1'
    )

    expect((bvm as any).embedHidden).toBe(false)
    expect(mockWindow.contentView.children).toContain(mockView)
    expect(mockView.setBounds).toHaveBeenCalledWith({ x: 100, y: 100, width: 800, height: 600 })
  })

  it('clearCardSlackEmbed only detaches view if matching target key', () => {
    const bvm = new BrowserViewManager()
    const mockView = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() } as any
    ;(bvm as any).views.set('card:p1:whatsapp', mockView)
    ;(bvm as any).cardEmbedKey = 'card:p1:whatsapp'

    const children: any[] = [mockView]
    const mockWindow = {
      contentView: {
        children,
        removeChildView: vi.fn((v: any) => {
          const idx = children.indexOf(v)
          if (idx !== -1) children.splice(idx, 1)
        })
      }
    } as any

    // Attempt clearing with an old key (e.g. from teams unmount race)
    bvm.clearCardSlackEmbed(mockWindow, 'card:p1:teams')
    expect(mockWindow.contentView.children).toContain(mockView)
    expect((bvm as any).cardEmbedKey).toBe('card:p1:whatsapp')

    // Now clear with the exact key
    bvm.clearCardSlackEmbed(mockWindow, 'card:p1:whatsapp')
    expect(mockWindow.contentView.children).not.toContain(mockView)
    expect((bvm as any).cardEmbedKey).toBeNull()
  })

  it('setEmbedVisible(false) removes ALL child views from contentView and sets embedHidden to true', () => {
    const bvm = new BrowserViewManager()
    const view1 = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() } as any
    const view2 = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() } as any

    const children: any[] = [view1, view2]
    const mockWindow = {
      contentView: {
        children,
        removeChildView: vi.fn((v: any) => {
          const idx = children.indexOf(v)
          if (idx !== -1) children.splice(idx, 1)
        })
      }
    } as any

    bvm.setEmbedVisible(mockWindow, false)
    expect(mockWindow.contentView.children.length).toBe(0)
    expect((bvm as any).embedHidden).toBe(true)
  })

  it('clearCardSlackEmbed nullifies activeKey if it matches cardEmbedKey', () => {
    const bvm = new BrowserViewManager()
    const mockView = { webContents: { isDestroyed: () => false }, setBounds: vi.fn() } as any
    ;(bvm as any).views.set('card:p1:teams', mockView)
    ;(bvm as any).cardEmbedKey = 'card:p1:teams'
    ;(bvm as any).activeKey = 'card:p1:teams'

    const children: any[] = [mockView]
    const mockWindow = {
      contentView: {
        children,
        removeChildView: vi.fn((v: any) => {
          const idx = children.indexOf(v)
          if (idx !== -1) children.splice(idx, 1)
        })
      }
    } as any

    bvm.clearCardSlackEmbed(mockWindow)
    expect((bvm as any).cardEmbedKey).toBeNull()
    expect((bvm as any).activeKey).toBeNull()
    expect(mockWindow.contentView.children).not.toContain(mockView)
  })
})
