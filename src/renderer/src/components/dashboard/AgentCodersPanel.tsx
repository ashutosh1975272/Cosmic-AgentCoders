import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  useAgentCodersStore,
  SWARM_AGENTS,
  AGENTWORK_PORTAL_META,
  type SwarmAgentId
} from '../../hooks/useAgentCodersStore'
import ComposerAutocompletePopover, { AutocompleteItem } from './ComposerAutocompletePopover'
import CardLiveWebEmbed from './CardLiveWebEmbed'
import AgentWorkControlModal from './AgentWorkControlModal'

export const INNER_SIDEBAR_DEFAULT = 280
export const INNER_SIDEBAR_MIN = 180
export const INNER_SIDEBAR_MAX = 500
export const INNER_SIDEBAR_COLLAPSED_W = 64

interface AgentCodersPanelProps {
  projectId: string
  projectName: string
  profileId?: string
}

export default function AgentCodersPanel({
  projectId,
  projectName,
  profileId
}: AgentCodersPanelProps): React.JSX.Element {
  const activeAgentId = useAgentCodersStore((s) => s.activeAgentId)
  const activeView = useAgentCodersStore((s) => s.activeView)
  const agentMessages = useAgentCodersStore((s) => s.agentMessages)
  const tasks = useAgentCodersStore((s) => s.tasks)
  const swarmGoal = useAgentCodersStore((s) => s.swarmGoal)
  const swarmProgress = useAgentCodersStore((s) => s.swarmProgress)
  const isOrchestrating = useAgentCodersStore((s) => s.isOrchestrating)
  const setActiveAgent = useAgentCodersStore((s) => s.setActiveAgent)
  const setActiveView = useAgentCodersStore((s) => s.setActiveView)
  const loadProjectHistory = useAgentCodersStore((s) => s.loadProjectHistory)
  const dispatchTaskFromHead = useAgentCodersStore((s) => s.dispatchTaskFromHead)
  const postMessage = useAgentCodersStore((s) => s.postMessage)
  const resetSwarm = useAgentCodersStore((s) => s.resetSwarm)

  // Hydrate persistent chat history and swarm tasks for this project
  useEffect(() => {
    if (projectId) {
      loadProjectHistory(projectId)
    }
  }, [projectId, loadProjectHistory])

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('agentcoders_sidebar_width')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed >= INNER_SIDEBAR_MIN && parsed <= INNER_SIDEBAR_MAX) {
          return parsed
        }
      }
    }
    return INNER_SIDEBAR_DEFAULT
  })

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('agentcoders_sidebar_collapsed') === 'true'
    }
    return false
  })

  const [isDragging, setIsDragging] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [showControlModal, setShowControlModal] = useState(false)
  const [googleSession, setGoogleSession] = useState<{ hasSession: boolean; count: number } | null>(null)

  const refreshGoogleSession = useCallback(async () => {
    if (!window.api?.profiles?.checkCardGoogleSession || !projectId) return
    try {
      const res = await window.api.profiles.checkCardGoogleSession({ projectId, appId: 'agentwork' })
      setGoogleSession({ hasSession: Boolean(res?.hasGoogleSession), count: res?.count ?? 0 })
    } catch {
      setGoogleSession(null)
    }
  }, [projectId])

  useEffect(() => {
    if (activeView === 'agentwork') {
      void refreshGoogleSession()
    }
  }, [activeView, refreshGoogleSession])

  const handleGoogleOAuthLogin = async () => {
    if (!window.api?.profiles?.startCardAppLogin) return
    setIsAuthenticating(true)
    setAuthError(null)
    try {
      await window.api.profiles.startCardAppLogin({
        projectId,
        profileId: profileId || 'default',
        appId: 'agentwork'
      })
      await refreshGoogleSession()
    } catch (err: any) {
      console.error('AgentWork Google OAuth failed:', err)
      setAuthError(err?.message || 'Authentication failed')
    } finally {
      setIsAuthenticating(false)
    }
  }

  const [draft, setDraft] = useState('')
  const [autocompleteTrigger, setAutocompleteTrigger] = useState<'@' | '#' | '/' | '$' | null>(null)
  const [autocompleteQuery, setAutocompleteQuery] = useState('')
  const [triggerPos, setTriggerPos] = useState(-1)
  const justSelectedRef = useRef(false)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const activeAgent = SWARM_AGENTS.find((a) => a.id === activeAgentId) || SWARM_AGENTS[0]
  const currentMessages = agentMessages[activeAgentId] || []

  // Auto scroll to bottom of chat
  useEffect(() => {
    if (typeof chatEndRef.current?.scrollIntoView === 'function') {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentMessages.length, activeAgentId])

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('agentcoders_sidebar_collapsed', String(next))
        window.dispatchEvent(new CustomEvent('layout-bounds-change'))
      }
      return next
    })
  }, [])

  const handleWidthChange = useCallback((w: number) => {
    const clamped = Math.max(INNER_SIDEBAR_MIN, Math.min(INNER_SIDEBAR_MAX, w))
    setSidebarWidth(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem('agentcoders_sidebar_width', String(clamped))
      window.dispatchEvent(new CustomEvent('layout-bounds-change'))
    }
  }, [])

  const resetWidth = useCallback(() => {
    handleWidthChange(INNER_SIDEBAR_DEFAULT)
  }, [handleWidthChange])

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      const startX = e.clientX
      const startW = sidebarWidth
      setIsDragging(true)
      handle.setPointerCapture(e.pointerId)

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX
        const nextW = Math.max(INNER_SIDEBAR_MIN, Math.min(INNER_SIDEBAR_MAX, startW + delta))
        setSidebarWidth(nextW)
        if (typeof window !== 'undefined') {
          localStorage.setItem('agentcoders_sidebar_width', String(nextW))
          window.dispatchEvent(new CustomEvent('layout-bounds-change'))
        }
      }

      const onPointerUp = (ev: PointerEvent) => {
        setIsDragging(false)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('layout-bounds-change'))
        }
        try {
          handle.releasePointerCapture(ev.pointerId)
        } catch {
          // ignore
        }
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    },
    [sidebarWidth]
  )

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleWidthChange(sidebarWidth - 16)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleWidthChange(sidebarWidth + 16)
      } else if (e.key === 'Home') {
        e.preventDefault()
        handleWidthChange(INNER_SIDEBAR_MIN)
      } else if (e.key === 'End') {
        e.preventDefault()
        handleWidthChange(INNER_SIDEBAR_MAX)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resetWidth()
      }
    },
    [handleWidthChange, resetWidth, sidebarWidth]
  )

  const handleDraftChange = useCallback((text: string) => {
    setDraft(text)
    const textarea = composerRef.current
    if (!textarea) return

    const cursor = textarea.selectionStart ?? text.length
    const textBeforeCursor = text.slice(0, cursor)

    const match = textBeforeCursor.match(/(?:^|\s)([@#/$])([a-zA-Z0-9_-]*)$/)
    if (match) {
      setAutocompleteTrigger(match[1] as '@' | '#' | '/' | '$')
      setAutocompleteQuery(match[2] || '')
      setTriggerPos(cursor - (match[2]?.length || 0) - 1)
    } else {
      setAutocompleteTrigger(null)
      setAutocompleteQuery('')
      setTriggerPos(-1)
    }
  }, [])

  const handleSelectAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      const textarea = composerRef.current
      if (!textarea || triggerPos < 0) return

      justSelectedRef.current = true
      setTimeout(() => {
        justSelectedRef.current = false
      }, 150)

      const before = draft.slice(0, triggerPos)
      const after = draft.slice(textarea.selectionStart ?? draft.length)
      const nextDraft = `${before}${item.insertText}${after}`
      setDraft(nextDraft)
      setAutocompleteTrigger(null)
      setAutocompleteQuery('')
      setTriggerPos(-1)

      setTimeout(() => {
        textarea.focus()
        const newCursorPos = before.length + item.insertText.length
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      }, 10)
    },
    [draft, triggerPos]
  )

  const handleSend = () => {
    const text = draft.trim()
    if (!text) return

    if (activeAgentId === 'head') {
      dispatchTaskFromHead(text)
    } else {
      postMessage(activeAgentId, {
        senderId: 'user',
        senderName: 'You',
        text
      })

      // Generate contextual response from sub-agent
      setTimeout(() => {
        postMessage(activeAgentId, {
          senderId: activeAgentId,
          senderName: activeAgent.name,
          text: `Acknowledged: "${text}". Applying ${activeAgent.skills.join(', ')} directly to codebase.`
        })
      }, 800)
    }

    setDraft('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteTrigger !== null || justSelectedRef.current) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const activeTaskCountFor = (agentId: SwarmAgentId) => {
    return tasks.filter((t) => t.assignedTo === agentId && t.status !== 'completed').length
  }

  return (
    <div
      className="agentcoders-workspace"
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#0a0d14',
        color: '#e2e8f0',
        overflow: 'hidden'
      }}
    >
      {/* 1. Inner Sub-Agent Sidebar */}
      <aside
        data-testid="agentcoders-inner-sidebar"
        style={{
          width: sidebarCollapsed ? INNER_SIDEBAR_COLLAPSED_W : sidebarWidth,
          minWidth: sidebarCollapsed ? INNER_SIDEBAR_COLLAPSED_W : INNER_SIDEBAR_MIN,
          maxWidth: sidebarCollapsed ? INNER_SIDEBAR_COLLAPSED_W : INNER_SIDEBAR_MAX,
          background: 'rgba(15, 23, 42, 0.95)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          position: 'relative',
          transition: isDragging ? 'none' : 'width 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          userSelect: isDragging ? 'none' : 'auto'
        }}
      >
        {sidebarCollapsed ? (
          /* Collapsed Icon Rail Mode */
          <>
            <div
              style={{
                padding: '12px 8px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8
              }}
            >
              <button
                type="button"
                onClick={handleToggleCollapse}
                aria-label="Expand sidebar"
                title="Expand AgentCoders Sidebar (»)"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#94a3b8',
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                »
              </button>
              <span
                title={isOrchestrating ? 'A2A Orchestration Running' : 'A2A Active'}
                style={{
                  fontSize: 12,
                  display: 'inline-block'
                }}
              >
                {isOrchestrating ? '⚡' : '●'}
              </span>
            </div>

            {/* Collapsed Agent Icons */}
            <nav
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 6px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8
              }}
            >
              {/* 1. AgentWork Portal Icon (Position 1: Above Head Agent) */}
              <button
                type="button"
                onClick={() => setActiveView('agentwork')}
                aria-label="AgentWork Portal"
                title="AgentWork Portal (https://agents.excellencetechnologies.in/)"
                style={{
                  position: 'relative',
                  width: 42,
                  height: 42,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    activeView === 'agentwork'
                      ? 'rgba(34, 197, 94, 0.25)'
                      : 'rgba(255, 255, 255, 0.03)',
                  border:
                    activeView === 'agentwork'
                      ? '1px solid rgba(34, 197, 94, 0.5)'
                      : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: 18 }}>⚡</span>
              </button>

              {/* 2. Swarm Agents (Shifted Down) */}
              {SWARM_AGENTS.map((agent) => {
                const isSelected = activeView === agent.id
                const activeTasks = activeTaskCountFor(agent.id)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setActiveAgent(agent.id)}
                    aria-label={agent.name}
                    title={`${agent.name} (${agent.handle})\n${agent.role}`}
                    style={{
                      position: 'relative',
                      width: 42,
                      height: 42,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isSelected ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                      border: isSelected
                        ? '1px solid rgba(168, 85, 247, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{agent.icon}</span>
                    {activeTasks > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          minWidth: 14,
                          height: 14,
                          borderRadius: 7,
                          background: '#eab308',
                          color: '#000',
                          fontSize: 8.5,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 2px'
                        }}
                      >
                        {activeTasks}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            {/* Collapsed Progress Footer */}
            <div
              style={{
                padding: '10px 4px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4
              }}
              title={`Swarm Progress: ${swarmProgress}%`}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: '#38bdf8' }}>{swarmProgress}%</span>
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(255, 255, 255, 0.1)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${swarmProgress}%`,
                    height: '100%',
                    background:
                      swarmProgress === 100
                        ? '#22c55e'
                        : 'linear-gradient(90deg, #3b82f6, #a855f7)'
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          /* Expanded Sidebar Mode */
          <>
            <div
              style={{
                padding: '16px 14px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#f8fafc',
                      letterSpacing: '0.02em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    🤖 AgentCoders Swarm
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: isOrchestrating
                        ? 'rgba(34, 197, 94, 0.25)'
                        : 'rgba(168, 85, 247, 0.2)',
                      color: isOrchestrating ? '#4ade80' : '#c084fc',
                      border: isOrchestrating
                        ? '1px solid rgba(34, 197, 94, 0.5)'
                        : '1px solid rgba(168, 85, 247, 0.4)',
                      flexShrink: 0
                    }}
                  >
                    {isOrchestrating ? '⚡ A2A RUNNING' : 'A2A ACTIVE'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleToggleCollapse}
                  aria-label="Collapse sidebar"
                  title="Minimize sidebar to icon rail («)"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 4,
                    color: '#94a3b8',
                    cursor: 'pointer',
                    width: 24,
                    height: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    padding: 0,
                    flexShrink: 0,
                    marginLeft: 6
                  }}
                >
                  «
                </button>
              </div>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 11,
                  color: '#94a3b8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {projectName} · Matt Pocock (1st) & Ruflo A2A
              </p>
            </div>

            {/* Agent List */}
            <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
              {/* 1. AgentWork Portal Button (Position 1: Above Head Agent) */}
              <button
                type="button"
                data-testid="sidebar-agentwork-btn"
                onClick={() => setActiveView('agentwork')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  gap: 10,
                  padding: '9px 10px',
                  borderRadius: 6,
                  background:
                    activeView === 'agentwork' ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
                  border:
                    activeView === 'agentwork'
                      ? '1px solid rgba(34, 197, 94, 0.4)'
                      : '1px solid transparent',
                  color: activeView === 'agentwork' ? '#f8fafc' : '#cbd5e1',
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: 3,
                  transition: 'background 0.12s ease'
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 6,
                    background: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    flexShrink: 0
                  }}
                >
                  ⚡
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>
                      AgentWork
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(34, 197, 94, 0.25)',
                        color: '#86efac'
                      }}
                    >
                      PORTAL
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: activeView === 'agentwork' ? '#cbd5e1' : '#64748b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    agents.excellencetechnologies.in · Web Portal
                  </div>
                </div>
              </button>

              {/* 2. Swarm Agents (Shifted Down) */}
              {SWARM_AGENTS.map((agent) => {
                const isSelected = activeView === agent.id
                const activeTasks = activeTaskCountFor(agent.id)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    data-testid={`sidebar-agent-${agent.id}`}
                    onClick={() => setActiveAgent(agent.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      gap: 10,
                      padding: '9px 10px',
                      borderRadius: 6,
                      background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                      border: isSelected
                        ? '1px solid rgba(168, 85, 247, 0.4)'
                        : '1px solid transparent',
                      color: isSelected ? '#f8fafc' : '#cbd5e1',
                      cursor: 'pointer',
                      textAlign: 'left',
                      marginBottom: 3,
                      transition: 'background 0.12s ease'
                    }}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 6,
                        background: `${agent.accentColor}22`,
                        border: `1px solid ${agent.accentColor}44`,
                        flexShrink: 0
                      }}
                    >
                      {agent.icon}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 650 }}>{agent.name}</span>
                        {activeTasks > 0 && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: 'rgba(234, 179, 8, 0.25)',
                              color: '#fef08a'
                            }}
                          >
                            {activeTasks} active
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: isSelected ? '#cbd5e1' : '#64748b',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {agent.handle} · {agent.role.split('&')[0]}
                      </div>
                    </div>
                  </button>
                )
              })}
            </nav>

            {/* Swarm Status Footer */}
            <div
              style={{
                padding: '12px 14px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(10, 15, 30, 0.6)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  marginBottom: 4
                }}
              >
                <span style={{ color: '#94a3b8' }}>Swarm Progress:</span>
                <span style={{ fontWeight: 700, color: '#38bdf8' }}>{swarmProgress}%</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: 5,
                  borderRadius: 3,
                  background: 'rgba(255, 255, 255, 0.1)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    width: `${swarmProgress}%`,
                    height: '100%',
                    background:
                      swarmProgress === 100
                        ? '#22c55e'
                        : 'linear-gradient(90deg, #3b82f6, #a855f7)',
                    transition: 'width 0.4s ease'
                  }}
                />
              </div>
              {tasks.length > 0 && (
                <button
                  type="button"
                  onClick={resetSwarm}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '4px 8px',
                    fontSize: 10,
                    color: '#94a3b8',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                >
                  Reset Swarm State
                </button>
              )}
            </div>

            {/* Drag Resize Handle */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inner sidebar"
              aria-valuenow={sidebarWidth}
              aria-valuemin={INNER_SIDEBAR_MIN}
              aria-valuemax={INNER_SIDEBAR_MAX}
              tabIndex={0}
              title="Drag to resize · double-click to reset (280px)"
              onPointerDown={startResize}
              onDoubleClick={resetWidth}
              onKeyDown={onResizeKeyDown}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 6,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 10,
                background: isDragging ? 'rgba(168, 85, 247, 0.6)' : 'transparent',
                transition: 'background 0.15s ease'
              }}
            />
          </>
        )}
      </aside>

      {/* 2. Main Agent Content Area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          overflow: 'hidden'
        }}
      >
        {/* Top Platform Switcher Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'rgba(10, 15, 30, 0.95)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginRight: 4 }}>
              PLATFORM:
            </span>

            {/* Platform 1: AgentWork */}
            <button
              type="button"
              onClick={() => setActiveView('agentwork')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 5,
                background:
                  activeView === 'agentwork'
                    ? 'rgba(34, 197, 94, 0.25)'
                    : 'rgba(34, 197, 94, 0.1)',
                border:
                  activeView === 'agentwork'
                    ? '1px solid rgba(34, 197, 94, 0.6)'
                    : '1px solid rgba(34, 197, 94, 0.3)',
                color: '#4ade80',
                fontSize: 11,
                fontWeight: 650,
                cursor: 'pointer'
              }}
            >
              <span>⚡</span>
              <span>AgentWork</span>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 3,
                  background: activeView === 'agentwork' ? '#22c55e' : 'rgba(34, 197, 94, 0.3)',
                  color: activeView === 'agentwork' ? '#000' : '#86efac'
                }}
              >
                {activeView === 'agentwork' ? 'ACTIVE' : 'PORTAL'}
              </span>
            </button>

            {/* Platform 2: Antigravity */}
            <button
              type="button"
              disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 5,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#64748b',
                fontSize: 11,
                cursor: 'not-allowed'
              }}
              title="Google Antigravity Agentic IDE (Preview)"
            >
              <span>🪐</span>
              <span>Antigravity</span>
              <span
                style={{
                  fontSize: 7.5,
                  padding: '1px 4px',
                  borderRadius: 2,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#94a3b8'
                }}
              >
                PREVIEW
              </span>
            </button>

            {/* Platform 3: OpenCode */}
            <button
              type="button"
              disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 5,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#64748b',
                fontSize: 11,
                cursor: 'not-allowed'
              }}
              title="OpenCode Autonomous Synthesis Engine (Preview)"
            >
              <span>💻</span>
              <span>OpenCode</span>
              <span
                style={{
                  fontSize: 7.5,
                  padding: '1px 4px',
                  borderRadius: 2,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#94a3b8'
                }}
              >
                PREVIEW
              </span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748b' }}>
            <span>A2A Swarm Bus:</span>
            <span style={{ color: '#22c55e', fontWeight: 650 }}>● Online</span>
          </div>
        </div>

        {activeView === 'agentwork' ? (
          /* AgentWork Live Web Portal Embed */
          <div
            data-testid="agentwork-portal-container"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              height: '100%',
              overflow: 'hidden',
              background: '#0a0d14',
              position: 'relative'
            }}
          >
            {/* Slack-Style Control Bar */}
            <div
              data-testid="agentwork-top-control-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 14px',
                background: 'var(--surface, #161922)',
                borderBottom: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                fontSize: 12,
                color: 'var(--text, #e2e8f0)',
                flexShrink: 0
              }}
            >
              {/* Left: Icon, Title, Project Name, Connected Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
                    background: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.4)',
                    color: '#4ade80',
                    fontSize: 12,
                    flexShrink: 0
                  }}
                >
                  ⚡
                </span>
                <span style={{ fontWeight: 650, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                  AgentWork Workspace
                </span>
                <span
                  style={{
                    color: 'var(--text-faint, #94a3b8)',
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  · {projectName}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: '#4ade80',
                    background: 'rgba(74, 222, 128, 0.1)',
                    padding: '2px 7px',
                    borderRadius: 12,
                    fontWeight: 600,
                    flexShrink: 0
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#4ade80',
                      boxShadow: '0 0 6px rgba(74, 222, 128, 0.6)'
                    }}
                  />
                  Connected
                </span>

                {googleSession !== null && (
                  <span
                    data-testid="agentwork-google-session-badge"
                    title={
                      googleSession.hasSession
                        ? `Google identity session active (${googleSession.count} cookies present)`
                        : 'No Google identity session in card partition — click "Sign in with Google" to sync'
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10.5,
                      color: googleSession.hasSession ? '#38bdf8' : '#f59e0b',
                      background: googleSession.hasSession ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                      border: googleSession.hasSession ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                      padding: '2px 7px',
                      borderRadius: 12,
                      fontWeight: 600,
                      flexShrink: 0
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: googleSession.hasSession ? '#38bdf8' : '#f59e0b'
                      }}
                    />
                    {googleSession.hasSession ? 'Google Session Active' : 'Google Sync Needed'}
                  </span>
                )}
              </div>

              {/* Right: Control, Google OAuth / Re-authenticate, Reload, Open in Browser */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* 1. Control Button (Slack style) */}
                <button
                  type="button"
                  data-testid="agentwork-control-btn"
                  onClick={() => setShowControlModal((v) => !v)}
                  style={{
                    background: 'rgba(99, 102, 241, 0.22)',
                    border: '1px solid rgba(99, 102, 241, 0.45)',
                    color: '#c7d2fe',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontWeight: 650,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  title="Open AgentWork Workspace Control & Configuration"
                >
                  <span>⚙️ Control</span>
                  <span
                    style={{
                      fontSize: 10,
                      opacity: 0.85,
                      background: 'rgba(0,0,0,0.25)',
                      padding: '1px 5px',
                      borderRadius: 4
                    }}
                  >
                    A2A
                  </span>
                </button>

                {/* 2. Google OAuth Button */}
                <button
                  type="button"
                  data-testid="agentwork-oauth-btn"
                  onClick={() => void handleGoogleOAuthLogin()}
                  disabled={isAuthenticating}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: isAuthenticating ? '#94a3b8' : '#cbd5e1',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: isAuthenticating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s ease'
                  }}
                  title="Pre-seed Google session and sign in with Google OAuth"
                >
                  <span>🌐</span>
                  <span>{isAuthenticating ? 'Authenticating...' : 'Sign in with Google'}</span>
                </button>

                {/* 3. Reload Button */}
                <button
                  type="button"
                  onClick={() => {
                    void window.api?.profiles?.reloadCardEmbed?.()
                  }}
                  title="Reload AgentWork portal"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#cbd5e1',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <span>🔄</span>
                  <span>Reload</span>
                </button>

                {/* 4. Open in Browser Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.open(AGENTWORK_PORTAL_META.url, '_blank')
                    }
                  }}
                  title="Open in external browser"
                  style={{
                    background: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    color: '#86efac',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <span>↗️</span>
                  <span>Open in Browser</span>
                </button>
              </div>
            </div>

            {/* Error Banner if OAuth fails */}
            {authError && (
              <div
                style={{
                  padding: '6px 14px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#fca5a5',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>⚠️ {authError}</span>
                <button
                  type="button"
                  onClick={() => setAuthError(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* AgentWork Control Modal Overlay */}
            {showControlModal && (
              <AgentWorkControlModal
                projectId={projectId}
                projectName={projectName}
                profileId={profileId}
                isOpen={showControlModal}
                onClose={() => setShowControlModal(false)}
              />
            )}

            {/* Embedded Live Web View */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <CardLiveWebEmbed
                key={`agentwork-embed-${projectId || 'default'}`}
                projectId={projectId}
                profileId={profileId || 'default'}
                linkId="agentwork"
                url={AGENTWORK_PORTAL_META.url}
                hidden={showControlModal}
              />
            </div>
          </div>
        ) : (
          /* Agent Workspace (Header + Chat + Composer) */
          <>
            {/* Agent Header */}
            <header
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(10px)'
              }}
            >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{activeAgent.icon}</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{activeAgent.name}</span>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: `${activeAgent.accentColor}25`,
                    color: activeAgent.accentColor,
                    border: `1px solid ${activeAgent.accentColor}50`
                  }}
                >
                  {activeAgent.handle}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'rgba(255, 255, 255, 0.07)',
                    color: '#94a3b8'
                  }}
                >
                  {activeAgent.priority}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>{activeAgent.role}</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {activeAgent.skills.map((skill) => (
              <span
                key={skill}
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(168, 85, 247, 0.15)',
                  color: '#d8b4fe',
                  border: '1px solid rgba(168, 85, 247, 0.3)'
                }}
              >
                {skill}
              </span>
            ))}
          </div>
        </header>

        {/* If Head Agent: Show A2A Task Partitioning Board */}
        {activeAgentId === 'head' && tasks.length > 0 && (
          <section
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(10, 18, 36, 0.75)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', letterSpacing: '0.04em' }}>
                📋 A2A TASK PARTITIONING BOARD ({tasks.length} SUBTASKS)
              </span>
              {swarmGoal && (
                <span
                  style={{
                    fontSize: 10.5,
                    color: '#38bdf8',
                    maxWidth: 360,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Goal: {swarmGoal}
                </span>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 8
              }}
            >
              {tasks.map((task) => {
                const statusColor =
                  task.status === 'completed'
                    ? '#22c55e'
                    : task.status === 'in_progress'
                      ? '#38bdf8'
                      : task.status === 'blocked'
                        ? '#ef4444'
                        : '#64748b'

                return (
                  <div
                    key={task.id}
                    onClick={() => setActiveAgent(task.assignedTo)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.75)',
                      border: `1px solid ${statusColor}44`,
                      borderRadius: 6,
                      padding: 8,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 4
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: `${statusColor}22`,
                          color: statusColor
                        }}
                      >
                        {task.status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 9.5, color: '#94a3b8' }}>@{task.assignedAgentName}</span>
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#f1f5f9',
                        marginBottom: 4,
                        lineHeight: 1.2
                      }}
                    >
                      {task.title}
                    </div>

                    <div
                      style={{
                        width: '100%',
                        height: 3,
                        background: 'rgba(255, 255, 255, 0.08)',
                        borderRadius: 2,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${task.progress}%`,
                          height: '100%',
                          background: statusColor,
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Chat Feed */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          {currentMessages.map((msg) => {
            const isUser = msg.senderId === 'user'
            const isThreadReply = Boolean(
              msg.isFollowUp ||
                (msg.parentMessageId &&
                  !msg.parentMessageId.startsWith('msg-user-') &&
                  !msg.parentMessageId.startsWith('msg-task-'))
            )
            return (
              <div
                key={msg.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginLeft: isThreadReply && !isUser ? 20 : 0,
                  borderLeft: isThreadReply && !isUser ? '2px solid rgba(168, 85, 247, 0.5)' : undefined,
                  paddingLeft: isThreadReply && !isUser ? 10 : undefined
                }}
              >
                {isThreadReply && !isUser && (
                  <div
                    data-testid="threaded-reply-indicator"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 9,
                      color: '#c084fc',
                      fontWeight: 650,
                      marginBottom: -1
                    }}
                  >
                    <span>↳</span>
                    <span>Threaded follow-up</span>
                  </div>
                )}
                {isThreadReply && isUser && (
                  <div
                    data-testid="threaded-question-indicator"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 9,
                      color: '#c084fc',
                      fontWeight: 650,
                      marginBottom: -1,
                      alignSelf: 'flex-end'
                    }}
                  >
                    <span>↳</span>
                    <span>Follow-up question</span>
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    fontSize: 10,
                    color: '#94a3b8',
                    flexWrap: 'wrap'
                  }}
                >
                  <span style={{ fontWeight: 650 }}>{msg.senderName}</span>
                  <span>{msg.timestamp}</span>

                  {/* Provenance Tag */}
                  {msg.provenance === 'project_chat' && (
                    <span
                      data-testid="provenance-project-chat"
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(59, 130, 246, 0.2)',
                        color: '#93c5fd',
                        border: '1px solid rgba(59, 130, 246, 0.4)'
                      }}
                      title="Originated from Project Master Chat"
                    >
                      [Via Project Chat]
                    </span>
                  )}
                  {msg.provenance === 'agentcoders_inner' && (
                    <span
                      data-testid="provenance-dispatched"
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(168, 85, 247, 0.2)',
                        color: '#d8b4fe',
                        border: '1px solid rgba(168, 85, 247, 0.4)'
                      }}
                      title="Dispatched to Project Chat"
                    >
                      [Dispatched to Project Chat]
                    </span>
                  )}

                  {/* Telemetry Badge */}
                  {msg.telemetry && (
                    <span
                      data-testid="message-telemetry"
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#86efac',
                        border: '1px solid rgba(34, 197, 94, 0.3)'
                      }}
                      title={`Tokens: ${msg.telemetry.promptTokens} in / ${msg.telemetry.completionTokens} out`}
                    >
                      ⏱️ {(msg.telemetry.executionTimeMs / 1000).toFixed(1)}s · 🪙 ~{msg.telemetry.estimatedTokens} tokens
                    </span>
                  )}

                  {/* Thread Identifier */}
                  {msg.threadId && (
                    <span
                      data-testid="message-thread-tag"
                      style={{
                        fontSize: 8.5,
                        color: '#94a3b8'
                      }}
                    >
                      💬 #{msg.threadId.slice(-4)}
                    </span>
                  )}

                  {msg.assignedFromHead && (
                    <span
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(234, 179, 8, 0.2)',
                        color: '#facc15'
                      }}
                    >
                      A2A DELEGATION
                    </span>
                  )}
                  {msg.statusBadge && (
                    <span
                      style={{
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(34, 197, 94, 0.2)',
                        color: '#4ade80'
                      }}
                    >
                      {msg.statusBadge}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: isUser ? '#6366f1' : 'rgba(30, 41, 59, 0.85)',
                    border: isUser ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#f8fafc',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {msg.text}

                  {msg.codeSnippet && (
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 4,
                        background: '#090d16',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        fontSize: 11,
                        color: '#38bdf8',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}
                    >
                      {msg.codeSnippet}
                    </pre>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Quick Skill Action Pills */}
        <div
          style={{
            padding: '6px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflowX: 'auto',
            background: 'rgba(15, 23, 42, 0.6)'
          }}
        >
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Skills:</span>
          {['/ask-matt', '/tdd', '/code-review', '/plan', '/grill-me', '/implement'].map((sk) => (
            <button
              key={sk}
              type="button"
              onClick={() => {
                setDraft((prev) => `${prev ? `${prev} ` : ''}${sk} `)
                composerRef.current?.focus()
              }}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: 10,
                cursor: 'pointer'
              }}
            >
              {sk}
            </button>
          ))}
        </div>

        {/* Dedicated Swarm Composer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.95)',
            position: 'relative'
          }}
        >
          <ComposerAutocompletePopover
            trigger={autocompleteTrigger}
            query={autocompleteQuery}
            contextScope="agentcoders"
            onSelect={handleSelectAutocomplete}
            onClose={() => setAutocompleteTrigger(null)}
          />

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={
                activeAgentId === 'head'
                  ? 'Submit high-level coding goal to @HeadAgent (type @ for agents, / for skills)…'
                  : `Message ${activeAgent.name} directly (type @ for agents, / for skills)…`
              }
              style={{
                flex: 1,
                background: '#090d16',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12.5,
                lineHeight: 1.4,
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={draft.trim().length === 0}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                background: draft.trim().length > 0 ? '#8b5cf6' : 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: draft.trim().length > 0 ? '#fff' : '#64748b',
                fontWeight: 650,
                fontSize: 12,
                cursor: draft.trim().length > 0 ? 'pointer' : 'not-allowed',
                height: 40
              }}
            >
              {activeAgentId === 'head' ? 'Dispatch Swarm' : 'Send'}
            </button>
          </div>
        </div>
      </>
    )}
  </main>
    </div>
  )
}
