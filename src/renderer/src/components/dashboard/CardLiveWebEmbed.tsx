import { useEffect, useRef, useState } from 'react'

interface CardLiveWebEmbedProps {
  projectId?: string
  profileId?: string
  linkId: string
  url: string
  hidden?: boolean
}

export default function CardLiveWebEmbed({
  projectId,
  profileId,
  linkId,
  url,
  hidden = false
}: CardLiveWebEmbedProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const embedRef = useRef<HTMLDivElement>(null)
  const [useIframeFallback, setUseIframeFallback] = useState(false)

  useEffect(() => {
    // If running in browser or test without Electron IPC, fallback to iframe
    if (!window.api?.profiles?.activateCardWebEmbed) {
      setUseIframeFallback(true)
      return
    }

    if (hidden) {
      void window.api.profiles.clearCardSlackEmbed?.()
      void window.api.profiles.setEmbedVisible?.(false)
      return undefined
    }

    // Force embed visible when activating or unhiding
    void window.api?.profiles?.setEmbedVisible?.(true)

    const el = embedRef.current ?? containerRef.current
    if (!el) return

    let cancelled = false
    let animFrameId: number | null = null
    const lastBoundsRef = { current: null as { x: number; y: number; width: number; height: number } | null }

    const sendBounds = () => {
      if (cancelled) return
      const targetEl = embedRef.current ?? containerRef.current
      if (!targetEl) return
      const rect = targetEl.getBoundingClientRect()
      if (rect.width >= 20 && rect.height >= 20) {
        const bounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
        const last = lastBoundsRef.current
        if (
          !last ||
          last.x !== bounds.x ||
          last.y !== bounds.y ||
          last.width !== bounds.width ||
          last.height !== bounds.height
        ) {
          lastBoundsRef.current = bounds
          void window.api.profiles.updateCardSlackEmbedBounds?.(bounds)
        }
      }
    }

    const startTrackingLoop = (durationMs = 450) => {
      const startTime = performance.now()
      const step = (now: number) => {
        if (cancelled) return
        sendBounds()
        if (now - startTime < durationMs) {
          animFrameId = requestAnimationFrame(step)
        }
      }
      if (animFrameId) cancelAnimationFrame(animFrameId)
      animFrameId = requestAnimationFrame(step)
    }

    const rect = el.getBoundingClientRect()
    const initialBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
    lastBoundsRef.current = initialBounds

    void window.api.profiles
      .activateCardWebEmbed({
        projectId,
        profileId: profileId ?? 'default',
        linkId,
        url,
        bounds: initialBounds
      })
      .then(() => {
        if (!cancelled) {
          startTrackingLoop(400)
        }
      })
      .catch((err) => {
        console.error('Failed to activate CardLiveWebEmbed', err)
      })

    const ro = new ResizeObserver(() => {
      sendBounds()
    })
    ro.observe(el)
    if (document.body) {
      ro.observe(document.body)
    }

    const onResizeOrLayout = () => startTrackingLoop(400)
    const onTransitionEnd = () => startTrackingLoop(150)

    window.addEventListener('resize', onResizeOrLayout)
    window.addEventListener('scroll', sendBounds, true)
    window.addEventListener('layout-bounds-change', onResizeOrLayout)
    document.addEventListener('transitionrun', onResizeOrLayout)
    document.addEventListener('transitionstart', onResizeOrLayout)
    document.addEventListener('transitionend', onTransitionEnd)
    document.addEventListener('animationstart', onResizeOrLayout)
    document.addEventListener('animationend', onTransitionEnd)

    return () => {
      cancelled = true
      if (animFrameId) cancelAnimationFrame(animFrameId)
      ro.disconnect()
      window.removeEventListener('resize', onResizeOrLayout)
      window.removeEventListener('scroll', sendBounds, true)
      window.removeEventListener('layout-bounds-change', onResizeOrLayout)
      document.removeEventListener('transitionrun', onResizeOrLayout)
      document.removeEventListener('transitionstart', onResizeOrLayout)
      document.removeEventListener('transitionend', onTransitionEnd)
      document.removeEventListener('animationstart', onResizeOrLayout)
      document.removeEventListener('animationend', onTransitionEnd)
      void window.api?.profiles?.clearCardSlackEmbed?.()
    }
  }, [projectId, profileId, linkId, url, hidden])

  if (useIframeFallback) {
    return (
      <div style={{ width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0 }}>
        <iframe
          src={url}
          title={linkId}
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
          allow="microphone; camera; clipboard-read; clipboard-write"
        />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        flex: '1 1 0%',
        minHeight: 0,
        position: 'relative',
        background: '#0C0D11'
      }}
    >
      <div
        ref={embedRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'auto'
        }}
      />
    </div>
  )
}

