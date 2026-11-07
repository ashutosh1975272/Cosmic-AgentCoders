import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSource, ProjectSourceChannel } from '../../../../shared/dashboard-contract'

export interface AutocompleteItem {
  id: string
  label: string
  sublabel?: string
  badge?: string
  badgeColor?: string
  icon: string
  insertText: string
  category: 'account' | 'channel' | 'command' | 'persona' | 'platform' | 'agent' | 'skill'
}

interface ComposerAutocompletePopoverProps {
  trigger: '@' | '#' | '/' | '$' | null
  query: string
  sources?: ProjectSource[]
  channels?: ProjectSourceChannel[]
  isScoped?: boolean
  contextScope?: 'project' | 'agentcoders' | 'social'
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
}

export default function ComposerAutocompletePopover({
  trigger,
  query,
  sources = [],
  channels = [],
  isScoped = false,
  contextScope = 'project',
  onSelect,
  onClose
}: ComposerAutocompletePopoverProps): React.JSX.Element | null {
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<AutocompleteItem[]>(() => {
    const q = (query || '').toLowerCase().trim()

    // 0. Platform Triggers ($)
    if (trigger === '$') {
      const platforms: AutocompleteItem[] = []

      if (contextScope === 'agentcoders') {
        // When inside AgentCoders Swarm Workspace
        platforms.push(
          {
            id: 'plat-agentwork-active',
            label: '$AgentWork',
            sublabel: 'Connected Swarm Workspace · Direct multi-agent coding active',
            badge: 'ACTIVE PLATFORM',
            badgeColor: '#22c55e',
            icon: '⚡',
            insertText: '$AgentWork ',
            category: 'platform'
          },
          {
            id: 'plat-antigravity',
            label: '$Antigravity',
            sublabel: 'Google Antigravity Agentic IDE (Preview)',
            badge: 'PREVIEW',
            badgeColor: '#8b5cf6',
            icon: '🪐',
            insertText: '$Antigravity ',
            category: 'platform'
          },
          {
            id: 'plat-opencode',
            label: '$OpenCode',
            sublabel: 'OpenCode Autonomous Code Synthesis (Preview)',
            badge: 'PREVIEW',
            badgeColor: '#3b82f6',
            icon: '💻',
            insertText: '$OpenCode ',
            category: 'platform'
          }
        )
      } else {
        // When in Master Chat / other views
        platforms.push(
          {
            id: 'plat-agentwork',
            label: '$AgentWork',
            sublabel: 'Autonomous Multi-Agent Coding Environment (Swarm & A2A)',
            badge: 'ACTIVE SWARM',
            badgeColor: '#22c55e',
            icon: '⚡',
            insertText: '$AgentWork ',
            category: 'platform'
          },
          {
            id: 'plat-antigravity',
            label: '$Antigravity',
            sublabel: 'Google DeepMind Advanced Agentic Coding Environment',
            badge: 'ANTIGRAVITY',
            badgeColor: '#8b5cf6',
            icon: '🪐',
            insertText: '$Antigravity ',
            category: 'platform'
          },
          {
            id: 'plat-opencode',
            label: '$OpenCode',
            sublabel: 'Open-Source Autonomous Code Synthesis Engine',
            badge: 'OPENCODE',
            badgeColor: '#3b82f6',
            icon: '💻',
            insertText: '$OpenCode ',
            category: 'platform'
          }
        )
      }

      if (!q) return platforms
      return platforms.filter(
        (p) => p.label.toLowerCase().includes(q) || (p.sublabel && p.sublabel.toLowerCase().includes(q))
      )
    }

    // 1. Account & Coding Agent Mentions (@)
    if (trigger === '@') {
      const agentsAndAccounts: AutocompleteItem[] = []

      // Specialized Coding Swarm Agents
      agentsAndAccounts.push(
        {
          id: 'agent-head',
          label: '@HeadAgent',
          sublabel: '👑 Swarm Coordinator & Planner · Partitions tasks & delegates via A2A',
          badge: 'SWARM LEADER',
          badgeColor: '#eab308',
          icon: '👑',
          insertText: '@HeadAgent ',
          category: 'agent'
        },
        {
          id: 'agent-architect',
          label: '@Architect',
          sublabel: '🏗️ System & Codebase Architecture · Deep modules & domain modeling',
          badge: 'ARCHITECTURE',
          badgeColor: '#3b82f6',
          icon: '🏗️',
          insertText: '@Architect ',
          category: 'agent'
        },
        {
          id: 'agent-coder',
          label: '@Coder',
          sublabel: '💻 Implementation Engine · TDD, feature implementation, refactoring',
          badge: 'DEVELOPER',
          badgeColor: '#22c55e',
          icon: '💻',
          insertText: '@Coder ',
          category: 'agent'
        },
        {
          id: 'agent-reviewer',
          label: '@Reviewer',
          sublabel: '🔍 Code Reviewer · Two-axis review (Standards + Spec) & git guardrails',
          badge: 'REVIEWER',
          badgeColor: '#f97316',
          icon: '🔍',
          insertText: '@Reviewer ',
          category: 'agent'
        },
        {
          id: 'agent-tester',
          label: '@Tester',
          sublabel: '🧪 Test Engineer · TDD verification, unit & integration test suites',
          badge: 'TESTING',
          badgeColor: '#ec4899',
          icon: '🧪',
          insertText: '@Tester ',
          category: 'agent'
        },
        {
          id: 'agent-executor',
          label: '@AgentWorkExecutor',
          sublabel: '⚡ Runtime Execution Runner · Terminal commands & MCP execution bridge',
          badge: 'EXECUTOR',
          badgeColor: '#a855f7',
          icon: '⚡',
          insertText: '@AgentWorkExecutor ',
          category: 'agent'
        }
      )

      // Connected Social Accounts & Sessions
      const seen = new Set<string>()
      for (const s of sources) {
        if (s.enabled === false) continue
        if (s.role === 'ours') continue
        const plat = (s.platform || 'slack').toLowerCase()
        const rawName = s.workspaceName?.trim() || plat
        const key = `${plat}:${rawName}`
        if (seen.has(key)) continue
        seen.add(key)

        const cleanToken = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || plat
        const platBadge = plat.toUpperCase()
        const badgeColor =
          plat === 'teams' ? '#3b82f6' : plat === 'whatsapp' ? '#22c55e' : plat === 'discord' ? '#5865f2' : '#a855f7'

        agentsAndAccounts.push({
          id: s.id,
          label: `@${cleanToken}`,
          sublabel: `${platBadge} Session · ${s.channels?.length || 0} channels`,
          badge: platBadge,
          badgeColor,
          icon: plat === 'teams' ? '👥' : plat === 'whatsapp' ? '📱' : plat === 'discord' ? '🎮' : '⚡',
          insertText: `@${cleanToken} `,
          category: 'account'
        })
      }

      if (!q) return agentsAndAccounts
      return agentsAndAccounts.filter(
        (a) => a.label.toLowerCase().includes(q) || (a.sublabel && a.sublabel.toLowerCase().includes(q))
      )
    }

    // 2. Channel & Contact Mentions (#)
    if (trigger === '#') {
      const chanItems: AutocompleteItem[] = []
      for (const ch of channels) {
        if (ch.enabled === false) continue
        const isDm = Boolean(
          ch.isDm || ch.kind === 'dm' || ch.name.startsWith('@') || ch.name.toLowerCase().includes('you')
        )
        const cleanName = ch.name.replace(/^[#@]+/, '').replace(/\s*\(?you\)?$/i, '').trim() || 'channel'
        const symbol = isDm ? '@' : '#'

        chanItems.push({
          id: ch.id,
          label: `${symbol}${cleanName}`,
          sublabel: isDm
            ? `Direct Message · ${ch.agentWrite ? 'Write Authorized' : 'Read Monitored'}`
            : `${ch.isPrivate ? 'Private' : 'Public'} Channel · ${ch.agentWrite ? 'Write Authorized' : 'Read Monitored'}`,
          badge: ch.agentWrite ? 'WRITE' : 'READ',
          badgeColor: ch.agentWrite ? '#22c55e' : '#64748b',
          icon: isDm ? '👤' : ch.isPrivate ? '🔒' : '#',
          insertText: `#${cleanName} `,
          category: 'channel'
        })
      }

      if (!q) return chanItems
      return chanItems.filter(
        (c) => c.label.toLowerCase().includes(q) || (c.sublabel && c.sublabel.toLowerCase().includes(q))
      )
    }

    // 3. Slash Commands & Coding Skills (/)
    if (trigger === '/') {
      const skillsAndCommands: AutocompleteItem[] = [
        // Matt Pocock Skills (1st Priority)
        {
          id: 'skill-ask-matt',
          label: '/ask-matt',
          sublabel: '🧭 Ask which skill or flow fits your situation · Router over skills',
          badge: 'SKILL ROUTER',
          badgeColor: '#8b5cf6',
          icon: '🧭',
          insertText: '/ask-matt ',
          category: 'skill'
        },
        {
          id: 'skill-tdd',
          label: '/tdd',
          sublabel: '🧪 Test-Driven Development · Red-green-refactor cycle with automated tests',
          badge: 'TDD',
          badgeColor: '#10b981',
          icon: '🧪',
          insertText: '/tdd ',
          category: 'skill'
        },
        {
          id: 'skill-code-review',
          label: '/code-review',
          sublabel: '⚖️ Two-axis code review · Standards + Spec verification',
          badge: 'REVIEW',
          badgeColor: '#f59e0b',
          icon: '⚖️',
          insertText: '/code-review ',
          category: 'skill'
        },
        {
          id: 'skill-plan',
          label: '/plan',
          sublabel: '📝 Write comprehensive implementation plan before touching code',
          badge: 'PLANNING',
          badgeColor: '#3b82f6',
          icon: '📝',
          insertText: '/plan ',
          category: 'skill'
        },
        {
          id: 'skill-grill-me',
          label: '/grill-me',
          sublabel: '🔥 Stress-test architecture & design decisions with interactive interview',
          badge: 'INTERVIEW',
          badgeColor: '#ec4899',
          icon: '🔥',
          insertText: '/grill-me ',
          category: 'skill'
        },
        {
          id: 'skill-implement',
          label: '/implement',
          sublabel: '⚡ Autonomous implementation of tickets and specifications',
          badge: 'IMPLEMENT',
          badgeColor: '#06b6d4',
          icon: '⚡',
          insertText: '/implement ',
          category: 'skill'
        },
        {
          id: 'skill-codebase-design',
          label: '/codebase-design',
          sublabel: '📐 Design deep modules, interfaces, and AI-navigable architecture',
          badge: 'DESIGN',
          badgeColor: '#6366f1',
          icon: '📐',
          insertText: '/codebase-design ',
          category: 'skill'
        },
        {
          id: 'skill-domain-modeling',
          label: '/domain-modeling',
          sublabel: '🏛️ Build and sharpen domain models, glossary, and architectural records',
          badge: 'DOMAIN',
          badgeColor: '#84cc16',
          icon: '🏛️',
          insertText: '/domain-modeling ',
          category: 'skill'
        },
        {
          id: 'skill-diagnosing-bugs',
          label: '/diagnosing-bugs',
          sublabel: '🐛 Diagnosis loop for hard bugs, flakiness, and regressions',
          badge: 'DEBUG',
          badgeColor: '#ef4444',
          icon: '🐛',
          insertText: '/diagnosing-bugs ',
          category: 'skill'
        },
        {
          id: 'skill-migrate-to-shoehorn',
          label: '/migrate-to-shoehorn',
          sublabel: '👞 Migrate test assertions from "as" to shoehorn partial fixtures',
          badge: 'SHOEHORN',
          badgeColor: '#14b8a6',
          icon: '👞',
          insertText: '/migrate-to-shoehorn ',
          category: 'skill'
        },
        {
          id: 'skill-wizard',
          label: '/wizard',
          sublabel: '🧙 Generate interactive wizard for credential or infra provisioning',
          badge: 'WIZARD',
          badgeColor: '#a855f7',
          icon: '🧙',
          insertText: '/wizard ',
          category: 'skill'
        },

        // System & Action Commands
        {
          id: 'cmd-send',
          label: '/send',
          sublabel: 'Send exact verbatim text after colon: /send @slack #channel : <message>',
          badge: 'DIRECT DISPATCH',
          badgeColor: '#22c55e',
          icon: '🚀',
          insertText: '/send : ',
          category: 'command'
        },
        {
          id: 'cmd-ai-ans',
          label: '/ai-ans',
          sublabel: 'Draft grounded AI answer with persona: /ai-ans #channel [friendly] : <instruction>',
          badge: 'RAG COPILOT',
          badgeColor: '#a855f7',
          icon: '🤖',
          insertText: '/ai-ans [professional] : ',
          category: 'command'
        },
        {
          id: 'cmd-help',
          label: '/help',
          sublabel: 'Show interactive cheatsheet of all accounts, channels, and commands',
          badge: 'HELP',
          badgeColor: '#3b82f6',
          icon: '💡',
          insertText: '/help',
          category: 'command'
        },
        {
          id: 'cmd-help-slack',
          label: '/help-slack',
          sublabel: 'Show Slack workspace status, tokens, write permissions, and scrapers',
          badge: 'SLACK GUIDE',
          badgeColor: '#c084fc',
          icon: '⚡',
          insertText: '/help-slack',
          category: 'command'
        },
        {
          id: 'cmd-scrape',
          label: '/scrape',
          sublabel: 'Trigger immediate background scrape & sync across watched channels',
          badge: 'SYNC',
          badgeColor: '#f59e0b',
          icon: '🔄',
          insertText: '/scrape',
          category: 'command'
        },
        {
          id: 'cmd-status',
          label: '/status',
          sublabel: 'Check active token status, monitored channels, and rate limits',
          badge: 'STATUS',
          badgeColor: '#64748b',
          icon: '📊',
          insertText: '/status',
          category: 'command'
        }
      ]

      if (!q) return skillsAndCommands
      return skillsAndCommands.filter(
        (cmd) => cmd.label.toLowerCase().includes(q) || (cmd.sublabel && cmd.sublabel.toLowerCase().includes(q))
      )
    }

    return []
  }, [trigger, query, sources, channels, contextScope])

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, trigger])

  // Keyboard navigation listener on window
  useEffect(() => {
    if (!trigger || items.length === 0) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [trigger, items, selectedIndex, onSelect, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!trigger || items.length === 0) return null

  return (
    <div
      className="composer-autocomplete-popover"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 12,
        right: 12,
        maxHeight: 260,
        overflowY: 'auto',
        background: 'rgba(15, 23, 42, 0.96)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(168, 85, 247, 0.35)',
        borderRadius: 8,
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        padding: 4
      }}
      ref={listRef}
      role="listbox"
      aria-label="Autocomplete Suggestions"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px 6px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: 10,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <span>
          {trigger === '$'
            ? contextScope === 'agentcoders'
              ? 'Active Platform'
              : 'Choose Platform / Engine'
            : trigger === '@'
              ? contextScope === 'agentcoders'
                ? 'Coding Swarm Agents'
                : isScoped
                  ? 'Workspace Accounts'
                  : 'Mention Agent / Session'
              : trigger === '#'
                ? 'Mention Channel / Contact'
                : 'Skills & Slash Commands'}
        </span>
        <span style={{ fontSize: 9, color: '#64748b' }}>↑↓ navigate · ↵ select · esc close</span>
      </div>

      {items.map((item, index) => {
        const isSelected = index === selectedIndex
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: isSelected ? 'rgba(168, 85, 247, 0.22)' : 'transparent',
              border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
              cursor: 'pointer',
              transition: 'background 0.1s ease',
              marginTop: 2
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.06)',
                fontSize: 12,
                flexShrink: 0
              }}
            >
              {item.icon}
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    color: isSelected ? '#f1f5f9' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 650
                  }}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <span
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: item.badgeColor ? `${item.badgeColor}22` : 'rgba(255,255,255,0.1)',
                      color: item.badgeColor || '#94a3b8',
                      border: `1px solid ${item.badgeColor || '#94a3b8'}44`
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              {item.sublabel && (
                <span
                  style={{
                    color: '#94a3b8',
                    fontSize: 10.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.sublabel}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
