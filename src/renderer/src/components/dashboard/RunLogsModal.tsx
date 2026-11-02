import { useEffect, useRef, useState } from 'react'

export interface RunLogItem {
  runId: string
  ts: string
  trigger: 'scheduled' | 'manual'
  projectId: string
  sourceId: string
  sourceKind: 'token' | 'browser'
  workspaceId: string
  channelsRead: number
  newMessages: number
  snippets?: Array<{
    channelId: string
    channelName?: string
    sender: string
    ts: string
    snippet: string
  }>
  durationMs: number
  status: string
  error?: string
  errorCode?: string
}

interface RunLogsModalProps {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
}

export function RunLogsModal({ open, projectId, projectName, onClose }: RunLogsModalProps): React.JSX.Element | null {
  const [logs, setLogs] = useState<RunLogItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('all')
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)

  const selectedRunIdRef = useRef(selectedRunId)
  selectedRunIdRef.current = selectedRunId

  const fetchLogs = async () => {
    try {
      const data = await window.api.dashboard.getRunLogs({ projectId })
      setLogs(data)
      if (data.length > 0 && !selectedRunIdRef.current) {
        setSelectedRunId(data[0].runId)
      }
    } finally {
      // loaded
    }
  }

  useEffect(() => {
    if (open) {
      void fetchLogs()

      // Live subscription: auto-refresh whenever a scrape finishes or emits an event
      if (window.api?.dashboard?.onScrapeEvent) {
        const unsubscribe = window.api.dashboard.onScrapeEvent((event: any) => {
          if (event.type === 'run_finished' || event.type === 'status' || event.type === 'queued') {
            void fetchLogs()
          }
        })
        return () => {
          unsubscribe()
        }
      }
    }
    return undefined
  }, [open, projectId])

  if (!open) return null

  const workspaces = Array.from(new Set(logs.map((l) => l.workspaceId).filter(Boolean)))
  const filteredLogs = selectedWorkspace === 'all' ? logs : logs.filter((l) => l.workspaceId === selectedWorkspace)
  const activeRun = logs.find((l) => l.runId === selectedRunId) || filteredLogs[0] || null

  // Group snippets by channel for the active run
  const channelGroups: Record<string, typeof logs[0]['snippets']> = {}
  if (activeRun && activeRun.snippets) {
    for (const snip of activeRun.snippets) {
      const key = snip.channelName || snip.channelId
      if (!channelGroups[key]) channelGroups[key] = []
      channelGroups[key]!.push(snip)
    }
  }

  const activeChannelName = selectedChannel || Object.keys(channelGroups)[0] || null
  const activeSnippets = activeChannelName ? channelGroups[activeChannelName] || [] : []

  return (
    <div
      className="platform-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{ zIndex: 1200 }}
    >
      <div
        className="platform-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Automation Scraping Explorer"
        style={{
          width: '98%',
          maxWidth: '1440px',
          height: '95vh',
          maxHeight: '95vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#0b0f19',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.9)',
          overflow: 'hidden'
        }}
      >
        {/* Top Header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.7)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '18px' }}>🚀</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f8fafc' }}>
                Cosmic Automation &amp; Scraping Explorer
              </h2>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                Project: <b style={{ color: '#38bdf8' }}>{projectName}</b> · Full workspace message captures
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button type="button" className="btn ghost btn-sm" onClick={() => void fetchLogs()} title="Refresh logs">
              ⟳ Refresh
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={onClose}
              style={{ fontSize: '14px', padding: '4px 10px' }}
            >
              ✕ Close
            </button>
          </div>
        </header>

        {/* Workspace Selector Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '10px 20px',
            background: 'rgba(15, 23, 42, 0.4)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            alignItems: 'center'
          }}
        >
          <span style={{ fontSize: '12px', color: '#94a3b8', marginRight: '4px' }}>Filter Workspace:</span>
          <button
            type="button"
            className={`btn btn-sm ${selectedWorkspace === 'all' ? 'primary' : 'ghost'}`}
            onClick={() => setSelectedWorkspace('all')}
            style={{ fontSize: '12px', padding: '3px 10px' }}
          >
            All Workspaces ({logs.length})
          </button>
          {workspaces.map((ws) => (
            <button
              key={ws}
              type="button"
              className={`btn btn-sm ${selectedWorkspace === ws ? 'primary' : 'ghost'}`}
              onClick={() => setSelectedWorkspace(ws)}
              style={{ fontSize: '12px', padding: '3px 10px' }}
            >
              {ws} ({logs.filter((l) => l.workspaceId === ws).length})
            </button>
          ))}
        </div>

        {/* Main 2-Column Explorer */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Column: Run History Rail */}
          <div
            style={{
              width: '320px',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              overflowY: 'auto',
              background: 'rgba(15, 23, 42, 0.25)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Scrape Run History ({filteredLogs.length})
            </div>
            {filteredLogs.map((log) => {
              const isSelected = activeRun?.runId === log.runId
              const dateStr = new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              const isSuccess = log.status === 'connected'

              return (
                <div
                  key={log.runId}
                  onClick={() => {
                    setSelectedRunId(log.runId)
                    setSelectedChannel(null)
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)'}`,
                    background: isSelected ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background: isSuccess ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: isSuccess ? '#22c55e' : '#ef4444'
                      }}
                    >
                      {isSuccess ? 'Success' : log.status}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{dateStr}</span>
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#f8fafc', marginTop: '2px' }}>
                    {log.workspaceId}
                  </div>

                  <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>{log.channelsRead} channels read</span>
                    <span style={{ color: log.newMessages > 0 ? '#22c55e' : 'inherit', fontWeight: log.newMessages > 0 ? 600 : 400 }}>
                      +{log.newMessages} msgs
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right Column: Scraped Channels & Messages Detail */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeRun ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* Run Metadata Strip */}
                <div
                  style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', gap: '20px', alignItems: 'center', fontSize: '13px' }}>
                    <span>Workspace: <b style={{ color: '#38bdf8' }}>{activeRun.workspaceId}</b></span>
                    <span>Channels Scraped: <b>{activeRun.channelsRead}</b></span>
                    <span>New Messages: <b style={{ color: activeRun.newMessages > 0 ? '#22c55e' : '#f8fafc' }}>{activeRun.newMessages}</b></span>
                    <span>Duration: <b>{(activeRun.durationMs / 1000).toFixed(1)}s</b></span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Run ID: {activeRun.runId} · {new Date(activeRun.ts).toLocaleString()}
                  </div>
                </div>

                {/* Error Banner if any */}
                {(activeRun.error || activeRun.errorCode) && (
                  <div
                    style={{
                      margin: '12px 20px 0 20px',
                      fontSize: '12px',
                      color: '#f87171',
                      background: 'rgba(239, 68, 68, 0.08)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      borderLeft: '4px solid #ef4444'
                    }}
                  >
                    <b>Error occurred:</b> {activeRun.error || activeRun.errorCode}
                  </div>
                )}

                {/* Channel Selector Cards */}
                <div style={{ padding: '16px 20px 8px 20px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Select Scraped Channel to View Messages:
                  </div>
                  <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {Object.keys(channelGroups).length === 0 ? (
                      <div style={{ fontSize: '12px', color: '#64748b' }}>No messages captured in this run.</div>
                    ) : (
                      Object.entries(channelGroups).map(([chName, msgs]) => {
                        const isSelected = activeChannelName === chName
                        return (
                          <button
                            key={chName}
                            type="button"
                            onClick={() => setSelectedChannel(chName)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: `1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
                              background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                              color: isSelected ? '#38bdf8' : '#f8fafc',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <span>#{chName}</span>
                            <span
                              style={{
                                fontSize: '10px',
                                background: isSelected ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
                                color: '#ffffff',
                                padding: '1px 5px',
                                borderRadius: '10px'
                              }}
                            >
                              {msgs?.length || 0}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Messages Feed View */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px 20px' }}>
                  {activeSnippets.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                      No message snippets recorded for this channel in this run.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {activeSnippets.map((snip, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '12px 16px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                                {snip.sender}
                              </span>
                              <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                                #{snip.channelName || snip.channelId}
                              </span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>{snip.ts}</span>
                          </div>
                          <div
                            style={{
                              fontSize: '13px',
                              color: '#cbd5e1',
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              marginTop: '2px'
                            }}
                          >
                            {snip.snippet}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                Select a scrape run from the left panel to inspect captured messages.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
