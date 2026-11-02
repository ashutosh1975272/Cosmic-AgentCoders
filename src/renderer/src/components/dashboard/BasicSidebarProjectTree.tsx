import React, { useMemo, useState, useEffect } from 'react'
import { useDashboardStore } from '../../hooks/useDashboard'
import { useProfileStore } from '../../hooks/useProfiles'
import { AppIcon } from '../AppIcon'
import { getBaseLayoutItems, type BaseAppLayoutKey } from '../../../../shared/base-app-presets'
import type { AppId } from '../../../../shared/types'

interface BasicSidebarProjectTreeProps {
  baseAppLayout?: BaseAppLayoutKey
  onNewProject?: () => void
}

export function BasicSidebarProjectTree({
  baseAppLayout = 'standard',
  onNewProject
}: BasicSidebarProjectTreeProps): React.JSX.Element {
  const snapshot = useDashboardStore((s) => s.snapshot)
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot)
  const cosmicSelectedCardId = useDashboardStore((s) => s.cosmicSelectedCardId)
  const basicActiveTab = useDashboardStore((s) => s.basicActiveTab)
  const setBasicNavigation = useDashboardStore((s) => s.setBasicNavigation)
  const profiles = useProfileStore((s) => s.profiles)

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  // Ensure snapshot is loaded
  useEffect(() => {
    if (!snapshot) {
      void loadSnapshot().catch(() => undefined)
    }
  }, [snapshot, loadSnapshot])

  // Active projects across all profiles
  const activeProjects = useMemo(() => {
    if (!snapshot) return []
    return snapshot.projects.filter(
      (p) =>
        p.project.workflowStatus !== 'completed' &&
        p.project.workflowStatus !== 'removed'
    )
  }, [snapshot])

  // Auto-expand the currently selected project card if any
  useEffect(() => {
    if (cosmicSelectedCardId && expandedProjects[cosmicSelectedCardId] === undefined) {
      setExpandedProjects((prev) => ({ ...prev, [cosmicSelectedCardId]: true }))
    }
  }, [cosmicSelectedCardId, expandedProjects])

  // In Basic look, auto-select the first available project if none is selected
  useEffect(() => {
    if (!cosmicSelectedCardId && activeProjects.length > 0) {
      setBasicNavigation(activeProjects[0].project.id, 'dashboard')
    }
  }, [cosmicSelectedCardId, activeProjects, setBasicNavigation])

  // Preset links based on baseAppLayout setting (standard = option 1, extended = option 2, full = option 3)
  const presetItems = useMemo(() => {
    return getBaseLayoutItems(baseAppLayout)
  }, [baseAppLayout])

  const toggleProjectExpand = (projectId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setExpandedProjects((prev) => {
      const current = prev[projectId] ?? (projectId === cosmicSelectedCardId)
      return { ...prev, [projectId]: !current }
    })
  }

  const handleSelectTab = (projectId: string, tab: string): void => {
    setBasicNavigation(projectId, tab)
  }

  return (
    <div
      className="basic-sidebar-project-tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px 8px',
        overflowY: 'auto',
        flex: 1
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px',
          marginBottom: '2px'
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-faint, #64748b)'
          }}
        >
          Projects ({activeProjects.length})
        </span>
        {onNewProject && (
          <button
            type="button"
            onClick={onNewProject}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent, #6366f1)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
            title="Create new project card"
          >
            + New
          </button>
        )}
      </div>

      {activeProjects.length === 0 ? (
        <div
          style={{
            padding: '16px 8px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-faint, #64748b)'
          }}
        >
          No projects yet.
        </div>
      ) : (
        activeProjects.map((entry) => {
          const project = entry.project
          const projectId = project.id
          const isSelectedProject = cosmicSelectedCardId === projectId
          const isOpen = expandedProjects[projectId] ?? isSelectedProject
          const projectName = project.name || project.teamName || 'Untitled Project'
          const profile = profiles.find((p) => p.id === project.profileId)

          return (
            <div
              key={projectId}
              className={`basic-project-node${isSelectedProject ? ' is-selected' : ''}`}
            >
              {/* Project Row Header (Click toggles expand/collapse only) */}
              <button
                type="button"
                className="basic-project-header-btn"
                onClick={(e) => toggleProjectExpand(projectId, e)}
                title={`${projectName} (Click to expand/collapse)`}
              >
                <span
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-faint, #94a3b8)',
                    transition: 'transform 0.15s ease',
                    display: 'inline-block',
                    width: '12px'
                  }}
                  aria-hidden
                >
                  {isOpen ? '▼' : '▶'}
                </span>

                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    flexShrink: 0
                  }}
                  aria-hidden
                />

                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {projectName}
                </span>

                {profile && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-faint, #64748b)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '70px'
                    }}
                  >
                    {profile.displayName}
                  </span>
                )}
              </button>

              {/* Collapsible Dropdown Items (Dashboard, Slack, Teams, WhatsApp, etc.) */}
              {isOpen && (
                <div className="basic-project-children">
                  {/* 1. Dashboard Tab */}
                  {(() => {
                    const isDashActive = isSelectedProject && basicActiveTab === 'dashboard'
                    return (
                      <button
                        type="button"
                        className={`basic-project-tab-btn${isDashActive ? ' is-active' : ''}`}
                        onClick={() => handleSelectTab(projectId, 'dashboard')}
                      >
                        <span style={{ fontSize: '12px', lineHeight: 1 }} aria-hidden>
                          📊
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Dashboard
                        </span>
                      </button>
                    )
                  })()}

                  {/* 2. Preset Apps/Links (Slack, Teams, WhatsApp, etc.) */}
                  {presetItems.map((preset) => {
                    const tabKey = preset.appId ?? `c:preset:${preset.id}`
                    const isActive = isSelectedProject && basicActiveTab === tabKey

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`basic-project-tab-btn${isActive ? ' is-active' : ''}`}
                        onClick={() => handleSelectTab(projectId, tabKey)}
                      >
                        {preset.appId ? (
                          <AppIcon appId={preset.appId as AppId} size={13} />
                        ) : (
                          <span style={{ fontSize: '13px', lineHeight: 1 }} aria-hidden>
                            {preset.icon || '🌐'}
                          </span>
                        )}
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {preset.name}
                        </span>
                        {preset.appId === 'slack' && Boolean(project.teamId) && (
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#22c55e'
                            }}
                            title="Slack connected"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
