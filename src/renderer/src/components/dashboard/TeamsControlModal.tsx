import React, { useEffect, useMemo, useState } from 'react'
import type {
  DashboardProject,
  ProjectSource,
  ProjectSourceChannel,
  ProjectSourceSelectionMode
} from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import { ScrapeLogExplorer } from './RunLogsModal'

export interface TeamsControlModalProps {
  open: boolean
  onClose: () => void
  project: DashboardProject
  source: ProjectSource
  onSaved?: () => void
}

type ControlTab = 'channels' | 'schedules' | 'logs'

export function TeamsControlModal({
  open,
  onClose,
  project,
  source,
  onSaved
}: TeamsControlModalProps): React.JSX.Element | null {
  const syncNow = useDashboardStore((s) => s.syncNow)
  const updateSource = useDashboardStore((s) => s.updateSource)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)

  const [activeTab, setActiveTab] = useState<ControlTab>('channels')

  // Channels 4-tier stacked permissions state
  const [channels, setChannels] = useState<ProjectSourceChannel[]>([])
  const [selectedDashboard, setSelectedDashboard] = useState<Set<string>>(new Set())
  const [selectedAgentRead, setSelectedAgentRead] = useState<Set<string>>(new Set())
  const [selectedAgentWrite, setSelectedAgentWrite] = useState<Set<string>>(new Set())
  const [selectedAutoReply, setSelectedAutoReply] = useState<Set<string>>(new Set())
  const [channelSearch, setChannelSearch] = useState('')
  const [selectionMode, setSelectionMode] = useState<ProjectSourceSelectionMode>(
    source.selectionMode ?? 'include'
  )
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [savingChannels, setSavingChannels] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)

  // Schedules state
  const [scheduleEnabled, setScheduleEnabled] = useState(source.scheduleEnabled ?? true)
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    source.scheduleIntervalMinutes ?? 0.333
  )
  const [engineMode, setEngineMode] = useState<'direct_api' | 'browser'>(
    source.engineMode ?? 'direct_api'
  )
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setChannelsLoading(true)
    setChannelsError(null)
    setSelectionMode(source.selectionMode ?? 'include')
    setScheduleEnabled(source.scheduleEnabled ?? true)
    setIntervalMinutes(source.scheduleIntervalMinutes ?? 0.333)
    setEngineMode(source.engineMode ?? 'direct_api')

    const isTeams = (c: any) =>
      !String(c.id || '').startsWith('C') &&
      !String(c.id || '').startsWith('U') &&
      !String(c.name || '').startsWith('#') &&
      c.messageCount !== 0 &&
      c.hasMessages !== false

    const initialSourceChannels = (source.channels ?? []).filter(isTeams)
    const existing = new Map(initialSourceChannels.map((c) => [c.id, c]))
    const dashSet = new Set<string>()
    const agentReadSet = new Set<string>()
    const agentWriteSet = new Set<string>()
    const autoReplySet = new Set<string>()
    for (const c of initialSourceChannels) {
      if (c.enabled === true) dashSet.add(c.id)
      if (c.agentRead === true) agentReadSet.add(c.id)
      if (c.agentWrite === true) agentWriteSet.add(c.id)
      if (c.autoReply === true) autoReplySet.add(c.id)
    }
    setSelectedDashboard(dashSet)
    setSelectedAgentRead(agentReadSet)
    setSelectedAgentWrite(agentWriteSet)
    setSelectedAutoReply(autoReplySet)

    void window.api.dashboard
      .discoverSourceChannels({
        projectId: project.id,
        sourceId: source.id,
        platform: 'teams',
        profileId: source.profileId,
        workspaceId: source.workspaceId
      })
      .then((result) => {
        if (!alive) return
        if (result.error) setChannelsError(result.error)
        const validDiscovered = (result.channels || []).filter(isTeams)
        if (validDiscovered.length === 0) {
          setChannels(initialSourceChannels)
          return
        }
        setChannels(
          validDiscovered.map((channel) => {
            const previous = existing.get(channel.id)
            return {
              ...channel,
              enabled: previous ? previous.enabled === true : false,
              agentRead: previous ? previous.agentRead === true : false,
              agentWrite: previous ? previous.agentWrite === true : false,
              autoReply: previous ? previous.autoReply === true : false
            }
          })
        )
      })
      .catch((err) => {
        if (!alive) return
        setChannelsError(err instanceof Error ? err.message : 'Teams discovery failed')
        setChannels(initialSourceChannels)
      })
      .finally(() => {
        if (alive) setChannelsLoading(false)
      })

    return () => {
      alive = false
    }
  }, [open, project.id, source])

  // Suspend underlying WebContentsView when modal is open to prevent occlusion
  useEffect(() => {
    if (open) {
      void window.api?.profiles?.setEmbedVisible?.(false)
      return () => {
        void window.api?.profiles?.setEmbedVisible?.(true)
      }
    }
    return undefined
  }, [open])

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
  }, [channels, channelSearch])

  const grouped = useMemo(() => {
    const channelsList: ProjectSourceChannel[] = []
    const dms: ProjectSourceChannel[] = []
    for (const channel of filteredChannels) {
      if (channel.isDm || channel.kind === 'dm') dms.push(channel)
      else channelsList.push(channel)
    }
    return { channelsList, dms }
  }, [filteredChannels])

  if (!open) return null

  const toggleDashboard = (id: string) => {
    setSelectedDashboard((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAgentRead = (id: string) => {
    setSelectedAgentRead((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAgentWrite = (id: string) => {
    setSelectedAgentWrite((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAutoReply = (id: string) => {
    setSelectedAutoReply((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearAllPermissions = () => {
    setSelectedDashboard(new Set())
    setSelectedAgentRead(new Set())
    setSelectedAgentWrite(new Set())
    setSelectedAutoReply(new Set())
  }

  const selectAllDashboard = () => {
    setSelectedDashboard(new Set(channels.map((c) => c.id)))
  }

  const handleSaveChannels = async () => {
    setSavingChannels(true)
    try {
      const updatedChannels: ProjectSourceChannel[] = channels.map((channel) => ({
        ...channel,
        enabled: selectedDashboard.has(channel.id),
        agentRead: selectedAgentRead.has(channel.id),
        agentWrite: selectedAgentWrite.has(channel.id),
        autoReply: selectedAutoReply.has(channel.id)
      }))

      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: {
          platform: 'teams',
          workspaceName: source.workspaceName || 'Microsoft Teams',
          channels: updatedChannels,
          selectionMode,
          channelsReviewedAt: new Date().toISOString()
        }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback('Teams permissions saved successfully.')
      setTimeout(() => setSyncFeedback(null), 3000)
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : 'Failed to save Teams permissions')
    } finally {
      setSavingChannels(false)
    }
  }

  const handleUpdateSchedule = async (enabled: boolean, interval: number) => {
    setSavingSchedule(true)
    setScheduleEnabled(enabled)
    setIntervalMinutes(interval)
    try {
      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: {
          scheduleEnabled: enabled,
          scheduleIntervalMinutes: interval as any
        }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback('Schedule settings updated.')
      setTimeout(() => setSyncFeedback(null), 3000)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Failed to update schedule')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleUpdateEngineMode = async (mode: 'direct_api' | 'browser') => {
    setEngineMode(mode)
    try {
      await updateSource({
        projectId: project.id,
        sourceId: source.id,
        patch: { engineMode: mode }
      })
      await loadSnapshot()
      onSaved?.()
      setSyncFeedback(
        `Engine switched to ${mode === 'direct_api' ? '⚡ Direct API / Rapid Ingestion' : '🌐 Browser DOM'}.`
      )
      setTimeout(() => setSyncFeedback(null), 3500)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Failed to update engine mode')
    }
  }

  const handleManualScrapeNow = async () => {
    setManualSyncing(true)
    setSyncFeedback('Scraping initiated across Teams channels & chats…')
    try {
      await syncNow(project.id)
      await loadSnapshot()
      setSyncFeedback('Teams scrape finished. Dashboard updated!')
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err) {
      setSyncFeedback(err instanceof Error ? err.message : 'Teams scrape encountered an issue.')
    } finally {
      setManualSyncing(false)
    }
  }

  const renderGroup = (
    label: string,
    items: ProjectSourceChannel[],
    emptyMessage: string
  ) => {
    if (items.length === 0) {
      return (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            {label} (0)
          </div>
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
            {emptyMessage}
          </div>
        </div>
      )
    }

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{label} ({items.length})</span>
        </div>

        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(255, 255, 255, 0.02)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1fr) 125px 125px 125px 125px',
              padding: '8px 16px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 11,
              fontWeight: 700,
              color: '#94a3b8',
              letterSpacing: '0.04em'
            }}
          >
            <div>Channel / Chat</div>
            <div style={{ textAlign: 'center' }}>📊 Dashboard Scrape</div>
            <div style={{ textAlign: 'center' }}>🤖 Agent Read</div>
            <div style={{ textAlign: 'center' }}>✍️ Agent Write</div>
            <div style={{ textAlign: 'center' }} title="Real-time automated reply in 1-on-1 chats and when mentioned">
              ⚡ Auto-Reply
            </div>
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {items.map((channel) => {
              const isDash = selectedDashboard.has(channel.id)
              const isRead = selectedAgentRead.has(channel.id)
              const isWrite = selectedAgentWrite.has(channel.id)
              const isAutoReply = selectedAutoReply.has(channel.id)
              return (
                <div
                  key={channel.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(220px, 1fr) 125px 125px 125px 125px',
                    padding: '10px 16px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    alignItems: 'center',
                    background: isDash || isRead || isWrite || isAutoReply ? 'rgba(99, 102, 241, 0.04)' : 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: channel.isDm ? '#38bdf8' : '#818cf8' }}>
                      {channel.isDm ? '💬' : '👥'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>
                      {channel.name}
                    </span>
                  </div>

                  {/* Dashboard Scrape */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isDash}
                      onChange={() => toggleDashboard(channel.id)}
                      style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                    />
                  </div>

                  {/* Agent Read */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isRead}
                      onChange={() => toggleAgentRead(channel.id)}
                      style={{ cursor: 'pointer', accentColor: '#10b981' }}
                    />
                  </div>

                  {/* Agent Write */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isWrite}
                      onChange={() => toggleAgentWrite(channel.id)}
                      style={{ cursor: 'pointer', accentColor: '#f59e0b' }}
                    />
                  </div>

                  {/* Auto-Reply */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isAutoReply}
                      onChange={() => toggleAutoReply(channel.id)}
                      style={{ cursor: 'pointer', accentColor: '#06b6d4' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="add-platform-backdrop" onClick={onClose} style={{ zIndex: 99999 }}>
      <div
        className="add-platform-panel accounts-hub-panel"
        data-testid="teams-control-modal"
        style={{
          width: 'min(1440px, 98vw)',
          height: 'min(92vh, 920px)',
          maxHeight: 'min(92vh, 920px)',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#090d16',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)'
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Teams Workspace Control"
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.85)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 24 }}>👥</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                Teams Control · {source.workspaceName || project.name}
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Channel &amp; chat discovery • Rapid ingestion scheduling • Detailed scraping logs
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {syncFeedback && (
              <span style={{ fontSize: 12, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '4px 10px', borderRadius: 6 }}>
                {syncFeedback}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleManualScrapeNow()}
              disabled={manualSyncing}
              style={{
                fontSize: 12,
                fontWeight: 650,
                padding: '6px 14px',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: manualSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>{manualSyncing ? '⏳ Scraping…' : '▶ Scrape Now'}</span>
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={onClose}
              aria-label="Close"
              style={{ fontSize: 13, color: '#94a3b8', padding: '6px 12px' }}
            >
              ✕ Close
            </button>
          </div>
        </header>

        {/* 2-Column Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Navigation Rail */}
          <aside
            style={{
              width: 270,
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(15, 23, 42, 0.5)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 4px' }}>
              Control Options
            </div>

            <button
              type="button"
              data-testid="tab-channels"
              onClick={() => setActiveTab('channels')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'channels' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'channels' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'channels' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📋</span>
                <span>Channels &amp; Chats</span>
              </div>
              <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74, 222, 128, 0.12)', padding: '2px 6px', borderRadius: 4 }}>
                {selectedDashboard.size} Dash
              </span>
            </button>

            <button
              type="button"
              data-testid="tab-schedules"
              onClick={() => setActiveTab('schedules')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'schedules' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'schedules' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'schedules' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>⏱️</span>
                <span>Schedules &amp; Trigger</span>
              </div>
              <span style={{ fontSize: 11, color: scheduleEnabled ? '#4ade80' : '#94a3b8', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 6px', borderRadius: 4 }}>
                {scheduleEnabled ? `${intervalMinutes}m` : 'Paused'}
              </span>
            </button>

            <button
              type="button"
              data-testid="tab-logs"
              onClick={() => setActiveTab('logs')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'logs' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'logs' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'logs' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🕷️</span>
                <span>Scrape Logs</span>
              </div>
            </button>

            {/* Ingestion Engine Mode */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 8px' }}>
                Active Ingestion Engine
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: engineMode === 'direct_api' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)',
                    border: engineMode === 'direct_api' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="teamsEngineMode"
                    value="direct_api"
                    checked={engineMode === 'direct_api'}
                    onChange={() => void handleUpdateEngineMode('direct_api')}
                    style={{ accentColor: '#10b981' }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: engineMode === 'direct_api' ? '#a7f3d0' : '#cbd5e1' }}>
                      ⚡ Direct API Engine
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>~120ms rapid sync</div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: engineMode === 'browser' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.02)',
                    border: engineMode === 'browser' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="teamsEngineMode"
                    value="browser"
                    checked={engineMode === 'browser'}
                    onChange={() => void handleUpdateEngineMode('browser')}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: engineMode === 'browser' ? '#bfdbfe' : '#cbd5e1' }}>
                      🌐 Browser DOM Engine
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Headless WebContentsView</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Partition Card */}
            <div style={{ marginTop: 'auto', padding: '10px 12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', fontSize: 11, color: '#94a3b8' }}>
              <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: 4 }}>Session Partition</div>
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#818cf8', wordBreak: 'break-all' }}>
                persist:profile-{source.profileId || 'default'}-teams
              </div>
            </div>
          </aside>

          {/* Right Main Panel */}
          <main style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#090d16', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'channels' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                      Teams Permissions &amp; Channel Matrix
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                      Configure permissions for Dashboard Analytics, Agent Read Context, and Agent Write Dispatch across Microsoft Teams channels &amp; chats.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={clearAllPermissions}
                      style={{ fontSize: 12, padding: '5px 10px' }}
                    >
                      Clear all
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={selectAllDashboard}
                      style={{ fontSize: 12, padding: '5px 10px' }}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSaveChannels()}
                      disabled={savingChannels}
                      style={{ fontSize: 12, padding: '6px 14px', background: '#6366f1', color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer' }}
                    >
                      {savingChannels ? 'Saving…' : 'Save Permissions'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search Teams channels or chats…"
                    value={channelSearch}
                    onChange={(e) => setChannelSearch(e.target.value)}
                    style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#f8fafc', fontSize: 13 }}
                  />
                </div>

                {channelsError && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 6, color: '#fca5a5', fontSize: 12 }}>
                    ⚠️ {channelsError}
                  </div>
                )}

                {channelsLoading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    Discovering Teams channels &amp; chats…
                  </div>
                ) : filteredChannels.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 16px', color: '#94a3b8' }}>
                    <p style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0', marginBottom: 6 }}>
                      No active conversations found
                    </p>
                    <p style={{ fontSize: 12 }}>
                      Only conversations with a minimum of 1 message are displayed. New conversations will appear automatically as soon as messages are received or sent.
                    </p>
                  </div>
                ) : (
                  <>
                    {renderGroup('Teams Channels', grouped.channelsList, 'No Teams channels discovered.')}
                    {renderGroup('Direct Chats & DMs', grouped.dms, 'No direct chats discovered.')}
                  </>
                )}
              </div>
            )}

            {activeTab === 'schedules' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                    Automated Ingestion Schedule
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                    Set automatic sync frequency for Teams messages. Rapid polling checks for newly active discussions.
                  </p>
                </div>

                <div style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: 8, padding: 18 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
                    <input
                      type="checkbox"
                      checked={scheduleEnabled}
                      onChange={(e) => void handleUpdateSchedule(e.target.checked, intervalMinutes)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    <strong style={{ fontSize: 14 }}>Enable Automated Background Scraping</strong>
                  </label>

                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>Ingestion Interval:</span>
                    {[0.333, 1, 5, 15, 60].map((interval) => (
                      <button
                        key={interval}
                        type="button"
                        onClick={() => void handleUpdateSchedule(scheduleEnabled, interval)}
                        disabled={savingSchedule}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: intervalMinutes === interval ? '#6366f1' : '#1e293b',
                          color: intervalMinutes === interval ? '#fff' : '#cbd5e1',
                          border: '1px solid #334155',
                          cursor: 'pointer'
                        }}
                      >
                        {interval === 0.333 ? '20s (Rapid)' : `${interval}m`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                    Teams Scraping &amp; Sync Audit Logs
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                    Detailed history of automated and manual sync executions for Teams.
                  </p>
                </div>
                <ScrapeLogExplorer projectId={project.id} sourceId={source.id} platform="teams" />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
