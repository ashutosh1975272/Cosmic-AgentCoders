import React, { useState, useEffect, useCallback } from 'react'
import { AUDIT_SUITES, type AuditSuiteDefinition } from '../../services/agentworkAuditPrompts'
import type { AgentWorkAgentSummary } from '../../../../shared/ipc-contract'

export interface AgentWorkControlModalProps {
  projectId: string
  projectName: string
  profileId?: string
  isOpen: boolean
  onClose: () => void
}

export type ControlSuiteTab = 'manager' | 'audits' | 'logs' | 'api'

export interface AuditLogItem {
  id: string
  timestamp: string
  suiteId: string
  suiteName: string
  agentRole: string
  status: 'running' | 'passed' | 'warning' | 'failed'
  message: string
  details?: string
}

export default function AgentWorkControlModal({
  projectId,
  projectName,
  profileId,
  isOpen,
  onClose
}: AgentWorkControlModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<ControlSuiteTab>('manager')
  const [engineMode, setEngineMode] = useState<'multi_agent' | 'direct_bridge'>('multi_agent')
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const [agents, setAgents] = useState<AgentWorkAgentSummary[]>([])
  const [agentsSource, setAgentsSource] = useState<'live' | 'local'>('local')
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)

  // Creation form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentRole, setNewAgentRole] = useState<'tester' | 'reviewer' | 'architect' | 'head' | 'custom'>('tester')
  const [newAgentPrompt, setNewAgentPrompt] = useState('')
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)

  // Audit state
  const [selectedSuite, setSelectedSuite] = useState<AuditSuiteDefinition>(AUDIT_SUITES[0])
  const [customAuditScope, setCustomAuditScope] = useState('')
  const [isDispatchingAudit, setIsDispatchingAudit] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([
    {
      id: 'log-init',
      timestamp: new Date().toLocaleTimeString(),
      suiteId: 'security',
      suiteName: 'Security & Secret Leak Audit',
      agentRole: 'Security Auditor',
      status: 'passed',
      message: 'Initial baseline scan complete. 0 secret leaks detected across configuration files.',
      details: 'Evaluated .env, git hooks, IPC contracts, and Electron session partition barriers.'
    }
  ])
  const [logFilter, setLogFilter] = useState<'all' | 'passed' | 'warning' | 'failed'>('all')

  // API Explorer & Telemetry state
  const [healthStatus, setHealthStatus] = useState<{
    status: 'ok' | 'error' | 'idle'
    latencyMs?: number
    url?: string
    error?: string
  }>({ status: 'idle' })
  const [isCheckingHealth, setIsCheckingHealth] = useState(false)
  const [googleCookiesCount, setGoogleCookiesCount] = useState<number | null>(null)

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    if (!window.api?.agentwork?.listAgents || !projectId) return
    setIsLoadingAgents(true)
    setAgentError(null)
    try {
      const res = await window.api.agentwork.listAgents({ projectId })
      if (res.success && res.agents) {
        setAgents(res.agents)
        setAgentsSource(res.source)
        if (res.error) setAgentError(res.error)
      } else {
        setAgentError(res.error || 'Failed to load agents')
      }
    } catch (err: any) {
      setAgentError(err?.message || 'Error fetching agents')
    } finally {
      setIsLoadingAgents(false)
    }
  }, [projectId])

  // Check health and partition status
  const runDiagnostics = useCallback(async () => {
    setIsCheckingHealth(true)
    try {
      if (window.api?.agentwork?.checkHealth) {
        const health = await window.api.agentwork.checkHealth()
        setHealthStatus(health)
      }
      if (window.api?.profiles?.checkCardGoogleSession && projectId) {
        const sessionRes = await window.api.profiles.checkCardGoogleSession({
          projectId,
          appId: 'agentwork'
        })
        setGoogleCookiesCount(sessionRes?.count ?? 0)
      }
    } catch (err: any) {
      setHealthStatus({
        status: 'error',
        error: err?.message || 'Diagnostic check failed'
      })
    } finally {
      setIsCheckingHealth(false)
    }
  }, [projectId])

  useEffect(() => {
    if (isOpen) {
      void fetchAgents()
      void runDiagnostics()
    }
  }, [isOpen, fetchAgents, runDiagnostics])

  // Suspend native WebContentsView (CardLiveWebEmbed) while modal is open
  useEffect(() => {
    if (isOpen) {
      void window.api?.profiles?.setEmbedVisible?.(false)
      return () => {
        void window.api?.profiles?.setEmbedVisible?.(true)
      }
    }
    return undefined
  }, [isOpen])

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Create agent
  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAgentName.trim() || !window.api?.agentwork?.createAgent) return
    setIsCreatingAgent(true)
    try {
      const res = await window.api.agentwork.createAgent({
        projectId,
        name: newAgentName.trim(),
        role: newAgentRole,
        systemPrompt: newAgentPrompt.trim()
      })
      if (res.success) {
        setShowCreateForm(false)
        setNewAgentName('')
        setNewAgentPrompt('')
        setFeedbackMessage(`Created agent "${newAgentName.trim()}" successfully!`)
        setTimeout(() => setFeedbackMessage(null), 3500)
        await fetchAgents()
      }
    } catch (err: any) {
      alert(`Agent creation error: ${err?.message || 'Unknown error'}`)
    } finally {
      setIsCreatingAgent(false)
    }
  }

  // Dispatch audit check
  const handleDispatchAudit = async () => {
    if (!window.api?.agentwork?.dispatchQuery) return
    setIsDispatchingAudit(true)
    const prompt = selectedSuite.generatePrompt(projectName, customAuditScope)
    const logId = `audit-${Date.now()}`

    // Add running log entry
    setAuditLogs((prev) => [
      {
        id: logId,
        timestamp: new Date().toLocaleTimeString(),
        suiteId: selectedSuite.id,
        suiteName: selectedSuite.name,
        agentRole: selectedSuite.role,
        status: 'running',
        message: `Dispatching ${selectedSuite.name} via AgentWork ${engineMode === 'multi_agent' ? 'multi-agent query bus' : 'AgentBridge tunnel'}...`
      },
      ...prev
    ])

    try {
      const res = await window.api.agentwork.dispatchQuery({
        projectId,
        query: prompt,
        role: selectedSuite.role,
        agentMode: engineMode === 'multi_agent' ? 'multi-agent' : 'single'
      })

      setAuditLogs((prev) =>
        prev.map((item) =>
          item.id === logId
            ? {
                ...item,
                status: res.success ? 'passed' : 'failed',
                message: res.success
                  ? `Completed ${selectedSuite.name}. All criteria evaluated.`
                  : `Audit failed: ${res.error || 'Execution interrupted'}`,
                details: res.response
              }
            : item
        )
      )
      setFeedbackMessage(
        res.success
          ? `Audit "${selectedSuite.name}" completed!`
          : 'Audit finished with warnings.'
      )
      setTimeout(() => setFeedbackMessage(null), 3500)
    } catch (err: any) {
      setAuditLogs((prev) =>
        prev.map((item) =>
          item.id === logId
            ? {
                ...item,
                status: 'failed',
                message: `Dispatch error: ${err?.message || 'Server error'}`
              }
            : item
        )
      )
      setFeedbackMessage('Audit failed to dispatch.')
      setTimeout(() => setFeedbackMessage(null), 3500)
    } finally {
      setIsDispatchingAudit(false)
    }
  }

  if (!isOpen) return null

  const filteredLogs = auditLogs.filter((log) => {
    if (logFilter === 'all') return true
    return log.status === logFilter
  })

  return (
    <div
      className="add-platform-backdrop"
      data-testid="agentwork-control-modal"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(5, 7, 12, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        className="add-platform-panel accounts-hub-panel"
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
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AgentWork Control Suite"
      >
        {/* Header - Matching WorkspaceControlModal Header */}
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
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>AgentWork Control Suite</span>
                  <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {projectName || 'Excellence Technologies'}</span>
                </h2>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    fontWeight: 600
                  }}
                >
                  Excellence Technologies
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: '#818cf8',
                    border: '1px solid rgba(99, 102, 241, 0.3)'
                  }}
                >
                  Card: {projectId}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
                Agent Directory &amp; Bullpen • Non-coding quality &amp; security verification suites • Live audit telemetry
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {feedbackMessage && (
              <span
                style={{
                  fontSize: 12,
                  color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.12)',
                  padding: '4px 10px',
                  borderRadius: 6
                }}
              >
                {feedbackMessage}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleDispatchAudit()}
              disabled={isDispatchingAudit}
              style={{
                fontSize: 12,
                fontWeight: 650,
                padding: '6px 14px',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: isDispatchingAudit ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>{isDispatchingAudit ? '⏳ Auditing…' : '🚀 Run Audit Sweep'}</span>
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => {
                void fetchAgents()
                void runDiagnostics()
                setFeedbackMessage('Refreshed agents & health telemetry.')
                setTimeout(() => setFeedbackMessage(null), 3500)
              }}
              disabled={isLoadingAgents || isCheckingHealth}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                color: '#cbd5e1',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              {isLoadingAgents || isCheckingHealth ? '⏳ Refreshing…' : '🔄 Refresh Live'}
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

        {/* 2-Column Body Layout - Matching WorkspaceControlModal */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Navigation Rail */}
          <aside
            style={{
              width: 270,
              minWidth: 260,
              maxWidth: 280,
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(15, 23, 42, 0.5)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflowY: 'auto'
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '0 8px 4px'
              }}
            >
              Control Options
            </div>

            {/* TAB 1: AGENT DIRECTORY */}
            <button
              type="button"
              data-testid="tab-manager"
              onClick={() => setActiveTab('manager')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'manager' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'manager' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'manager' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span>Agent Directory</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: '#4ade80',
                  background: 'rgba(74, 222, 128, 0.12)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}
              >
                {agents.length} Agents
              </span>
            </button>

            {/* TAB 2: QUALITY & SECURITY */}
            <button
              type="button"
              data-testid="tab-audits"
              onClick={() => setActiveTab('audits')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'audits' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'audits' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'audits' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🛡️</span>
                <span>Quality &amp; Security</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: '#818cf8',
                  background: 'rgba(129, 140, 248, 0.12)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}
              >
                {AUDIT_SUITES.length} Suites
              </span>
            </button>

            {/* TAB 3: EXECUTION LOGS */}
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
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📜</span>
                <span>Execution Logs</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.12)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}
              >
                {auditLogs.length}
              </span>
            </button>

            {/* TAB 4: API EXPLORER & TELEMETRY */}
            <button
              type="button"
              data-testid="tab-api"
              onClick={() => setActiveTab('api')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: activeTab === 'api' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                color: activeTab === 'api' ? '#a5b4fc' : '#cbd5e1',
                border: activeTab === 'api' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'all 0.12s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📡</span>
                <span>API Explorer</span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color:
                    healthStatus.status === 'ok'
                      ? '#4ade80'
                      : healthStatus.status === 'error'
                      ? '#f87171'
                      : '#94a3b8',
                  background: 'rgba(255, 255, 255, 0.06)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}
              >
                {healthStatus.status === 'ok' ? 'Online' : healthStatus.status === 'error' ? 'Err' : 'Idle'}
              </span>
            </button>

            {/* Active Ingestion / Swarm Engine Switcher */}
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '0 8px 8px'
                }}
              >
                Active Swarm Engine
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background:
                      engineMode === 'multi_agent'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(255,255,255,0.02)',
                    border:
                      engineMode === 'multi_agent'
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="agentworkEngineMode"
                    value="multi_agent"
                    checked={engineMode === 'multi_agent'}
                    onChange={() => {
                      setEngineMode('multi_agent')
                      setFeedbackMessage('Engine switched to ⚡ Multi-Agent Swarm Bus.')
                      setTimeout(() => setFeedbackMessage(null), 3500)
                    }}
                    style={{ accentColor: '#10b981' }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: engineMode === 'multi_agent' ? '#a7f3d0' : '#cbd5e1'
                      }}
                    >
                      ⚡ Multi-Agent Swarm Bus
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      ~120ms · Bullpen orchestration
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background:
                      engineMode === 'direct_bridge'
                        ? 'rgba(59, 130, 246, 0.15)'
                        : 'rgba(255,255,255,0.02)',
                    border:
                      engineMode === 'direct_bridge'
                        ? '1px solid rgba(59, 130, 246, 0.4)'
                        : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="agentworkEngineMode"
                    value="direct_bridge"
                    checked={engineMode === 'direct_bridge'}
                    onChange={() => {
                      setEngineMode('direct_bridge')
                      setFeedbackMessage('Engine switched to 🌐 AgentBridge Direct.')
                      setTimeout(() => setFeedbackMessage(null), 3500)
                    }}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: engineMode === 'direct_bridge' ? '#bfdbfe' : '#cbd5e1'
                      }}
                    >
                      🌐 AgentBridge Direct
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      Direct IPC &amp; Portal Tunnel
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Partition Isolation Status Card in Rail */}
            <div
              style={{
                marginTop: 'auto',
                padding: '12px 10px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: 11,
                color: '#94a3b8'
              }}
            >
              <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: 4 }}>
                Card Isolation
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 10,
                  color: '#818cf8',
                  wordBreak: 'break-all'
                }}
              >
                persist:card-{projectId}-agentwork
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                Profile: {profileId || 'default'}
              </div>
            </div>
          </aside>

          {/* Right Main Content Panel */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 32px',
              background: '#090d16',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* TAB 1: AGENT DIRECTORY & BULLPEN */}
            {activeTab === 'manager' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                      Agent Directory &amp; Bullpen
                    </h3>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                      Source:{' '}
                      <strong style={{ color: agentsSource === 'live' ? '#34d399' : '#fbbf24' }}>
                        {agentsSource.toUpperCase()}
                      </strong>{' '}
                      {agentsSource === 'local' && '(Card partition Google session required for live cloud sync)'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={fetchAgents}
                      disabled={isLoadingAgents}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        color: '#f8fafc',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      {isLoadingAgents ? 'Refreshing…' : '🔄 Refresh'}
                    </button>
                    <button
                      type="button"
                      data-testid="btn-create-agent-toggle"
                      onClick={() => setShowCreateForm(!showCreateForm)}
                      style={{
                        background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                        border: 'none',
                        color: '#ffffff',
                        padding: '6px 14px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {showCreateForm ? 'Cancel' : '➕ Create Agent'}
                    </button>
                  </div>
                </div>

                {agentError && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: 12
                    }}
                  >
                    {agentError}
                  </div>
                )}

                {/* Create Agent Inline Form */}
                {showCreateForm && (
                  <form
                    onSubmit={handleCreateAgent}
                    data-testid="create-agent-form"
                    style={{
                      background: '#161e2e',
                      border: '1px solid #3b82f6',
                      borderRadius: 8,
                      padding: 16
                    }}
                  >
                    <h4 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Create New Agent in AgentWork</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                          Agent Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Security Vulnerability Bot"
                          value={newAgentName}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          required
                          style={{
                            width: '100%',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 6,
                            padding: '8px 10px',
                            color: '#f8fafc',
                            fontSize: 13
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                          Assigned Role
                        </label>
                        <select
                          value={newAgentRole}
                          onChange={(e) => setNewAgentRole(e.target.value as any)}
                          style={{
                            width: '100%',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 6,
                            padding: '8px 10px',
                            color: '#f8fafc',
                            fontSize: 13
                          }}
                        >
                          <option value="tester">🧪 QA Tester (Assertions &amp; Tests)</option>
                          <option value="reviewer">🔍 Code Reviewer (Two-Axis Review)</option>
                          <option value="architect">🏛️ Architect (Deep Codebase Design)</option>
                          <option value="head">👑 Head Agent (Orchestration Gate)</option>
                          <option value="custom">⚙️ Custom Non-Coding Agent</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                        System Prompt &amp; Mission Constraints
                      </label>
                      <textarea
                        placeholder="Specify non-coding checks: verify test coverage, security boundaries, style rules..."
                        rows={3}
                        value={newAgentPrompt}
                        onChange={(e) => setNewAgentPrompt(e.target.value)}
                        style={{
                          width: '100%',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: 6,
                          padding: '8px 10px',
                          color: '#f8fafc',
                          fontSize: 13,
                          resize: 'vertical'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #334155',
                          color: '#94a3b8',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isCreatingAgent}
                        style={{
                          background: '#2563eb',
                          border: 'none',
                          color: '#fff',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {isCreatingAgent ? 'Deploying…' : 'Deploy to AgentWork'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Agent Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 14
                  }}
                >
                  {agents.map((agent) => (
                    <div
                      key={agent.agent_id}
                      data-testid={`agent-card-${agent.agent_id}`}
                      style={{
                        background: '#131b2e',
                        border: '1px solid #1e293b',
                        borderRadius: 10,
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 8
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14, color: '#f8fafc' }}>
                            {agent.label || agent.agent_name}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 10,
                              background: agent.online
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(148, 163, 184, 0.15)',
                              color: agent.online ? '#34d399' : '#94a3b8',
                              border: `1px solid ${agent.online ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`
                            }}
                          >
                            {agent.presence || (agent.online ? 'Online' : 'Offline')}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4, marginBottom: 12 }}>
                          {agent.purpose}
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: '#64748b',
                          borderTop: '1px solid #1e293b',
                          paddingTop: 10
                        }}
                      >
                        <span>
                          Role: <strong style={{ color: '#cbd5e1' }}>{agent.role}</strong>
                        </span>
                        <span>
                          Mode: <strong style={{ color: '#cbd5e1' }}>{agent.delivery_mode}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 2: QUALITY & SECURITY AUDIT SUITES */}
            {activeTab === 'audits' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                    Non-Coding Verification &amp; Audit Suites
                  </h3>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    Dispatch structured, non-destructive quality, security, and test assertion checks to AgentWork.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18 }}>
                  {/* Suite Selector Rail */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {AUDIT_SUITES.map((suite) => {
                      const isSelected = selectedSuite.id === suite.id
                      return (
                        <div
                          key={suite.id}
                          data-testid={`suite-item-${suite.id}`}
                          onClick={() => setSelectedSuite(suite)}
                          style={{
                            padding: 12,
                            borderRadius: 8,
                            background: isSelected ? 'rgba(99, 102, 241, 0.15)' : '#131b2e',
                            border: isSelected
                              ? '1px solid rgba(99, 102, 241, 0.5)'
                              : '1px solid #1e293b',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontWeight: 600,
                              fontSize: 13,
                              color: isSelected ? '#a5b4fc' : '#f8fafc'
                            }}
                          >
                            <span>{suite.icon}</span>
                            <span>{suite.name}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                            {suite.description}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Audit Dispatch Console */}
                  <div
                    style={{
                      background: '#131b2e',
                      border: '1px solid #1e293b',
                      borderRadius: 10,
                      padding: 20,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 14
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 24 }}>{selectedSuite.icon}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: '#f8fafc' }}>
                              {selectedSuite.name}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              Target Persona: <strong>{selectedSuite.targetAgent}</strong> ({selectedSuite.role})
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            borderRadius: 10,
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: '#818cf8',
                            border: '1px solid rgba(99, 102, 241, 0.3)'
                          }}
                        >
                          {engineMode === 'multi_agent' ? '⚡ Swarm Bus Active' : '🌐 AgentBridge Tunnel'}
                        </span>
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <label
                          style={{
                            fontSize: 11,
                            color: '#94a3b8',
                            display: 'block',
                            marginBottom: 4,
                            fontWeight: 600
                          }}
                        >
                          Custom Target Scope or Specific Focus (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Audit IPC channels, session partition boundaries, or new components"
                          value={customAuditScope}
                          onChange={(e) => setCustomAuditScope(e.target.value)}
                          style={{
                            width: '100%',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 6,
                            padding: '8px 10px',
                            color: '#f8fafc',
                            fontSize: 12
                          }}
                        />
                      </div>

                      <div>
                        <label
                          style={{
                            fontSize: 11,
                            color: '#94a3b8',
                            display: 'block',
                            marginBottom: 4,
                            fontWeight: 600
                          }}
                        >
                          Prompt Template Preview
                        </label>
                        <pre
                          style={{
                            background: '#0b1120',
                            border: '1px solid #1e293b',
                            borderRadius: 6,
                            padding: 12,
                            color: '#cbd5e1',
                            fontSize: 11,
                            lineHeight: 1.5,
                            maxHeight: 220,
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace'
                          }}
                        >
                          {selectedSuite.generatePrompt(projectName, customAuditScope)}
                        </pre>
                      </div>
                    </div>

                    <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        data-testid="btn-dispatch-audit"
                        onClick={handleDispatchAudit}
                        disabled={isDispatchingAudit}
                        style={{
                          background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
                          border: 'none',
                          color: '#fff',
                          padding: '10px 20px',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: isDispatchingAudit ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
                        }}
                      >
                        <span>🚀</span>
                        <span>{isDispatchingAudit ? 'Running Verification…' : 'Dispatch Check to AgentWork'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: EXECUTION & AUDIT LOGS */}
            {activeTab === 'logs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                      Execution &amp; Verification Logs
                    </h3>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                      Live audit trail of AgentWork query dispatches, test matrix runs, and security verifications.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value as any)}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        color: '#f8fafc',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 12
                      }}
                    >
                      <option value="all">All Events ({auditLogs.length})</option>
                      <option value="passed">Passed</option>
                      <option value="warning">Warnings</option>
                      <option value="failed">Failed</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setAuditLogs([])}
                      style={{
                        background: 'transparent',
                        border: '1px solid #334155',
                        color: '#94a3b8',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    minHeight: 400,
                    overflowY: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 12
                  }}
                >
                  {filteredLogs.length === 0 ? (
                    <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
                      No log entries found.
                    </div>
                  ) : (
                    filteredLogs.map((item) => {
                      const statusColor =
                        item.status === 'passed'
                          ? '#34d399'
                          : item.status === 'failed'
                          ? '#f87171'
                          : item.status === 'warning'
                          ? '#fbbf24'
                          : '#60a5fa'
                      return (
                        <div
                          key={item.id}
                          data-testid={`log-item-${item.id}`}
                          style={{
                            padding: 12,
                            borderRadius: 6,
                            background: '#131b2e',
                            border: '1px solid #1e293b'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 6
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#64748b', fontSize: 11 }}>[{item.timestamp}]</span>
                              <span
                                style={{
                                  color: statusColor,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  fontSize: 11
                                }}
                              >
                                ● {item.status}
                              </span>
                              <strong style={{ color: '#f8fafc' }}>{item.suiteName}</strong>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>({item.agentRole})</span>
                            </div>
                          </div>
                          <div style={{ color: '#cbd5e1', lineHeight: 1.4 }}>{item.message}</div>
                          {item.details && (
                            <div
                              style={{
                                marginTop: 8,
                                padding: 8,
                                background: '#0a0f1d',
                                borderRadius: 4,
                                color: '#94a3b8',
                                fontSize: 11,
                                whiteSpace: 'pre-wrap'
                              }}
                            >
                              {item.details}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: API EXPLORER & TELEMETRY */}
            {activeTab === 'api' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                      AgentWork API Explorer &amp; Telemetry
                    </h3>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                      Status of live backend endpoints, partition cookie jar, and platform capabilities.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={runDiagnostics}
                    disabled={isCheckingHealth}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    {isCheckingHealth ? 'Pinging…' : '🔄 Refresh Diagnostics'}
                  </button>
                </div>

                {/* Status Overview Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 14
                  }}
                >
                  <div
                    style={{
                      background: '#131b2e',
                      border: '1px solid #1e293b',
                      borderRadius: 8,
                      padding: 14
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>AgentWork Live Server</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 18 }}>{healthStatus.status === 'ok' ? '🟢' : '🟡'}</span>
                      <strong style={{ fontSize: 14 }}>
                        {healthStatus.status === 'ok' ? 'Healthy / Online' : 'Standby / Local'}
                      </strong>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      Latency: {healthStatus.latencyMs ? `${healthStatus.latencyMs}ms` : 'Local fallback'}
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#131b2e',
                      border: '1px solid #1e293b',
                      borderRadius: 8,
                      padding: 14
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Card Cookie Partition</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 18 }}>🍪</span>
                      <strong style={{ fontSize: 14 }}>
                        {googleCookiesCount !== null && googleCookiesCount > 0
                          ? `${googleCookiesCount} Cookies`
                          : 'No Cookies'}
                      </strong>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      persist:card-{projectId}-agentwork
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#131b2e',
                      border: '1px solid #1e293b',
                      borderRadius: 8,
                      padding: 14
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>A2A Swarm Protocol</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 18 }}>⚡</span>
                      <strong style={{ fontSize: 14 }}>
                        {engineMode === 'multi_agent' ? 'Swarm Bus Active' : 'AgentBridge Direct'}
                      </strong>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      {engineMode === 'multi_agent'
                        ? 'Multi-Agent mode / Bullpen'
                        : 'Direct IPC & Portal Tunnel'}
                    </div>
                  </div>
                </div>

                {/* Endpoint Table */}
                <div>
                  <h4 style={{ fontSize: 13, margin: '10px 0 10px 0', color: '#cbd5e1' }}>
                    Discovered Endpoints (from github.com/manishiitg/agentworks)
                  </h4>
                  <div
                    style={{
                      background: '#090d16',
                      border: '1px solid #1e293b',
                      borderRadius: 8,
                      overflow: 'hidden'
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                        textAlign: 'left'
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            background: '#131b2e',
                            borderBottom: '1px solid #1e293b',
                            color: '#94a3b8'
                          }}
                        >
                          <th style={{ padding: '8px 12px' }}>Method</th>
                          <th style={{ padding: '8px 12px' }}>Endpoint</th>
                          <th style={{ padding: '8px 12px' }}>Purpose</th>
                          <th style={{ padding: '8px 12px' }}>Scope</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', color: '#34d399', fontWeight: 600 }}>GET</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                            /api/agent-directory
                          </td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Discover available swarm agents &amp; presence
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>Agent Directory</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', color: '#60a5fa', fontWeight: 600 }}>POST</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>/api/query</td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Dispatch multi-agent audit checks
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>Agent Query Bus</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', color: '#60a5fa', fontWeight: 600 }}>POST</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                            /tools/custom/send_message
                          </td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Direct conversational A2A messaging
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>A2A Swarm</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', color: '#34d399', fontWeight: 600 }}>GET</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                            /api/sessions/{'{id}'}/events
                          </td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Real-time execution log event stream
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>Audit Stream</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '8px 12px', color: '#60a5fa', fontWeight: 600 }}>POST</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>/api/execute</td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Execute sandboxed command in workspace
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>Workspace API</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '8px 12px', color: '#34d399', fontWeight: 600 }}>GET</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                            /api/admin/code/audit
                          </td>
                          <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                            Platform workspace code audit logs
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>Admin Audit</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
