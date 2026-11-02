import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  DashboardChatTokenStatus,
  DashboardProject
} from '../../../../shared/dashboard-contract'
import { useDashboardStore } from '../../hooks/useDashboard'
import AiSettingsForm from './AiSettingsForm'
import DashboardWizard from './DashboardWizard'
import { RunLogsModal } from './RunLogsModal'
import { SidebarLayoutView } from './SidebarLayoutView'
import {
  LayoutMode,
  DEFAULT_LAYOUT
} from './sidebar-layout'
import { useSidebarLayout } from './use-sidebar-layout'
import {
  SourceStatusBadge,
  WorkspacePicker,
  type ProfileWorkspaceOption
} from './sources'
import { useProfileStore } from '../../hooks/useProfiles'
import type { ProjectSource } from '../../../../shared/dashboard-contract'
import { CardAddModal } from './CardAddModal'

export type SettingsTabKey = 'general' | 'ai' | 'sources' | 'channels' | 'schedule' | 'sidebar' | 'danger'

interface ProjectSettingsTabProps {
  project: DashboardProject
  onDelete?: (projectId: string) => void
}

export default function ProjectSettingsTab({
  project,
  onDelete
}: ProjectSettingsTabProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('ai')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [editWorkspace, setEditWorkspace] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Sources management state
  const profiles = useProfileStore((s) => s.profiles)
  const workspaceOptions: ProfileWorkspaceOption[] = profiles.flatMap((p) =>
    p.apps.slack.availableWorkspaces.map((w) => ({
      profileId: p.id,
      profileEmail: p.customName || p.displayName,
      workspaceId: w.teamId,
      workspaceName: w.teamName
    }))
  )
  const [newSourceKey, setNewSourceKey] = useState('')
  const [addingSource, setAddingSource] = useState(false)
  const [sourceNotice, setSourceNotice] = useState<string | null>(null)
  const [scrapingSourceId, setScrapingSourceId] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [cardAddModalOpen, setCardAddModalOpen] = useState(false)
  const [cardAddModalTab, setCardAddModalTab] = useState<'global' | 'my' | 'client'>('my')

  // Schedule state
  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [endDate, setEndDate] = useState(project.endDate ?? '')
  const [completion, setCompletion] = useState(
    project.manualCompletion != null ? String(project.manualCompletion) : ''
  )
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Layout state
  const { layout, updateLayout } = useSidebarLayout(project.id)

  // Token status
  const [tokenStatus, setTokenStatus] = useState<DashboardChatTokenStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.dashboard
      .getChatTokenStatus(project.id)
      .then((status) => {
        if (!cancelled) setTokenStatus(status)
      })
      .catch(() => {
        if (!cancelled) setTokenStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const handleModeChange = (mode: LayoutMode): void => {
    updateLayout({ ...layout, mode })
  }

  const handleToggleSection = (sectionKey: string): void => {
    const hidden = new Set(layout.custom.hiddenSections)
    if (hidden.has(sectionKey)) {
      hidden.delete(sectionKey)
    } else {
      hidden.add(sectionKey)
    }
    updateLayout({
      ...layout,
      custom: { ...layout.custom, hiddenSections: Array.from(hidden) }
    })
  }

  const handleResetLayout = (): void => {
    updateLayout(DEFAULT_LAYOUT)
  }

  const handleToggleActiveGlobalItem = (itemId: string, allItemIds: string[]): void => {
    // If activeGlobalItems is undefined, currently all items are active
    const current = layout.custom.activeGlobalItems !== undefined
      ? [...layout.custom.activeGlobalItems]
      : [...allItemIds]

    let updatedActive: string[]
    if (current.includes(itemId)) {
      // Deactivating: remove from activeGlobalItems AND remove from allowedGlobalLinks (hidden)
      updatedActive = current.filter((id) => id !== itemId)
    } else {
      // Activating: add to activeGlobalItems
      updatedActive = [...current, itemId]
    }

    // Keep allowedGlobalLinks consistent: if active items updated, keep allowed in sync
    const currentAllowed = layout.custom.allowedGlobalLinks !== undefined
      ? [...layout.custom.allowedGlobalLinks]
      : [...allItemIds]
    const updatedAllowed = current.includes(itemId)
      ? currentAllowed.filter((id) => id !== itemId)
      : (currentAllowed.includes(itemId) ? currentAllowed : [...currentAllowed, itemId])

    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        activeGlobalItems: updatedActive,
        allowedGlobalLinks: updatedAllowed
      }
    })
  }

  const handleToggleAllowedGlobalLink = (linkId: string, allGlobalItemIds: string[]): void => {
    // If allowedGlobalLinks is undefined, currently all active links are shown.
    const current = layout.custom.allowedGlobalLinks !== undefined
      ? [...layout.custom.allowedGlobalLinks]
      : [...allGlobalItemIds]

    let updated: string[]
    if (current.includes(linkId)) {
      updated = current.filter((id) => id !== linkId)
    } else {
      updated = [...current, linkId]
    }

    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        allowedGlobalLinks: updated
      }
    })
  }

  const handleToggleHideAddButton = (): void => {
    const isCurrentlyHidden = layout.custom.hideAddButton ?? true
    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        hideAddButton: !isCurrentlyHidden
      }
    })
  }

  const handleToggleSubItem = (parentKey: string, subItemKey: string): void => {
    const currentHidden = new Set(layout.custom.hiddenItems?.[parentKey] ?? [])
    if (currentHidden.has(subItemKey)) {
      currentHidden.delete(subItemKey)
    } else {
      currentHidden.add(subItemKey)
    }
    updateLayout({
      ...layout,
      custom: {
        ...layout.custom,
        hiddenItems: {
          ...layout.custom.hiddenItems,
          [parentKey]: Array.from(currentHidden)
        }
      }
    })
  }

  const saveSchedule = async (): Promise<void> => {
    setScheduleSaving(true)
    setScheduleNotice(null)
    setScheduleError(null)
    try {
      const parsed = completion === '' ? undefined : Number(completion)
      await useDashboardStore.getState().upsertProject({
        ...project,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        manualCompletion:
          parsed === undefined || !Number.isFinite(parsed)
            ? undefined
            : Math.max(0, Math.min(100, Math.round(parsed)))
      })
      setScheduleNotice('Schedule saved')
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Could not save the schedule')
    } finally {
      setScheduleSaving(false)
    }
  }

  const handleDeleteProject = async (): Promise<void> => {
    if (onDelete) {
      onDelete(project.id)
    } else {
      await useDashboardStore.getState().deleteProject(project.id)
    }
  }

  const isScheduleChanged =
    startDate !== (project.startDate ?? '') ||
    endDate !== (project.endDate ?? '') ||
    completion !== (project.manualCompletion != null ? String(project.manualCompletion) : '')

  const navItems: Array<{ key: SettingsTabKey; label: string; icon: string; danger?: boolean }> = [
    { key: 'general', label: 'General', icon: 'ℹ' },
    { key: 'ai', label: 'AI Configuration', icon: '✨' },
    { key: 'sources', label: 'Sources', icon: '🔌' },
    { key: 'channels', label: 'Channels', icon: '#' },
    { key: 'schedule', label: 'Schedule', icon: '📅' },
    { key: 'sidebar', label: 'Sidebar layout', icon: '◫' },
    { key: 'danger', label: 'Danger zone', icon: '⚠', danger: true }
  ]

  const handleToggleSourceEnabled = async (sourceId: string, currentEnabled: boolean): Promise<void> => {
    const updatedSources = (project.sources ?? []).map((s) =>
      s.id === sourceId ? { ...s, enabled: !currentEnabled } : s
    )
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: updatedSources
    })
    setSourceNotice(`Source ${currentEnabled ? 'paused' : 'resumed'}`)
    setTimeout(() => setSourceNotice(null), 3000)
  }

  const handleToggleChannelEnabled = async (sourceId: string, channelId: string, currentEnabled: boolean): Promise<void> => {
    const updatedSources = (project.sources ?? []).map((s) => {
      if (s.id !== sourceId) return s
      const updatedChannels = s.channels.map((ch) =>
        ch.id === channelId ? { ...ch, enabled: !currentEnabled } : ch
      )
      return { ...s, channels: updatedChannels }
    })
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: updatedSources
    })
    setSourceNotice(`Channel ${currentEnabled ? 'deselected' : 'selected'} for monitoring`)
    setTimeout(() => setSourceNotice(null), 3000)
  }

  const handleAddBrowserSource = async (): Promise<void> => {
    if (!newSourceKey) return
    const [profId, teamId] = newSourceKey.split(':')
    const opt = workspaceOptions.find((o) => `${o.profileId}:${o.workspaceId}` === newSourceKey)
    const now = new Date().toISOString()
    const newSource: ProjectSource = {
      id: `src-browser-${Date.now().toString(36)}`,
      kind: 'browser',
      platform: 'slack',
      profileId: profId,
      workspaceId: teamId,
      workspaceName: opt?.workspaceName || 'Slack Workspace',
      channels: project.monitors.map((m) => ({ id: m.channelId, name: m.channelName })),
      role: 'client',
      backfillDays: 7,
      enabled: true,
      status: 'connected',
      createdAt: now,
      updatedAt: now
    }
    const currentSources = project.sources ?? []
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: [...currentSources, newSource]
    })
    setAddingSource(false)
    setNewSourceKey('')
    setSourceNotice('Browser source added')
    setTimeout(() => setSourceNotice(null), 3000)
  }

  const handleScrapeSource = async (sourceId: string): Promise<void> => {
    setScrapingSourceId(sourceId)
    setSourceNotice('Scraping workspace messages via browser...')
    try {
      const res = await useDashboardStore.getState().syncSource({
        projectId: project.id,
        sourceId
      })
      if (res.status === 'success') {
        setSourceNotice(`Scraped successfully: ${res.newMessages} new messages found across ${res.channelsRead} channels.`)
      } else {
        setSourceNotice(res.error ? `Scrape failed: ${res.error}` : 'Scrape completed with issues.')
      }
    } catch (err) {
      setSourceNotice(err instanceof Error ? `Scrape error: ${err.message}` : 'Scrape failed')
    } finally {
      setScrapingSourceId(null)
      setTimeout(() => setSourceNotice(null), 5000)
    }
  }

  const handleRemoveSource = async (sourceId: string): Promise<void> => {
    const updatedSources = (project.sources ?? []).filter((s) => s.id !== sourceId)
    await useDashboardStore.getState().upsertProject({
      ...project,
      sources: updatedSources
    })
    setSourceNotice('Source removed')
    setTimeout(() => setSourceNotice(null), 3000)
  }

  return (
    <div className="ws-settings" data-testid="project-settings-tab">
      <div className="ws-settings-shell">
        {/* Sticky Header */}
        <header className="ws-settings-header" data-testid="settings-header">
          <div className="ws-settings-title-row">
            <div className="ws-settings-title-group">
              <h2 className="ws-settings-title">
                <span className="proj-name">{project.name}</span>
                <span className="proj-sep">/</span>
                <span className="proj-sub">Settings</span>
              </h2>
            </div>
          </div>
        </header>

        {/* Vertical Layout with Collapsible Nav Sidebar */}
        <div className="ws-settings-layout">
          <aside className={`ws-settings-nav-sidebar${navCollapsed ? ' is-collapsed' : ''}`} aria-label="Settings navigation">
            <div className="ws-settings-nav-toggle">
              <button
                type="button"
                className="ws-settings-nav-toggle-btn"
                onClick={() => setNavCollapsed((v) => !v)}
                title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {navCollapsed ? '»' : '«'}
              </button>
            </div>
            <ul className="ws-settings-nav-list" role="tablist">
              {navItems.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === item.key}
                    className={`ws-settings-nav-item${activeTab === item.key ? ' is-active' : ''}${item.danger ? ' is-danger' : ''}`}
                    onClick={() => setActiveTab(item.key)}
                    data-testid={`tab-${item.key}`}
                    title={navCollapsed ? item.label : undefined}
                  >
                    <span className="ws-settings-nav-icon">{item.icon}</span>
                    {!navCollapsed && <span className="ws-settings-nav-label">{item.label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="ws-settings-main-pane">
            {/* Single Scroll Container */}
            <div className="ws-settings-content" data-testid="settings-content">
          {/* TAB: GENERAL */}
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>General information</h4>
                  <p>Basic workspace metadata and card identity.</p>
                </header>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Project name
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={project.name}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-input)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Client workspace
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={project.clientName || project.teamName || '—'}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-input)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                      Project ID
                    </label>
                    <code
                      style={{
                        display: 'inline-block',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-chip)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontSize: '12px'
                      }}
                    >
                      {project.id}
                    </code>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB: AI */}
          {activeTab === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section
                className="ws-settings-section"
                id="project-ai-settings"
                tabIndex={-1}
                aria-label="AI settings"
              >
                <header className="ws-settings-head">
                  <h4>AI configuration</h4>
                  <p>
                    Used by this card&apos;s insight refresh and project chat. Leave{' '}
                    <b>Use global settings</b> on to inherit the dashboard workspace key and model.
                  </p>
                </header>
                <AiSettingsForm projectId={project.id} />
              </section>
            </div>
          )}

          {/* TAB: SOURCES */}
          {activeTab === 'sources' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4>Connected Sources</h4>
                      <p>Active token and passive browser automation sources feeding this project.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="dash-subtle"
                        onClick={() => setLogsOpen(true)}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        📋 View Run Logs
                      </button>
                      {!addingSource && (
                        <button
                          type="button"
                          className="dash-primary"
                          onClick={() => setAddingSource(true)}
                          style={{ fontSize: 13, padding: '6px 12px' }}
                        >
                          + Add Browser Source
                        </button>
                      )}
                    </div>
                  </div>
                </header>

                {sourceNotice && (
                  <div style={{ padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderRadius: 6, fontSize: 13 }}>
                    {sourceNotice}
                  </div>
                )}

                {addingSource && (
                  <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h5 style={{ margin: 0, fontSize: 14 }}>Add Logged-in Slack Workspace Source</h5>
                    <WorkspacePicker
                      options={workspaceOptions}
                      selectedKey={newSourceKey}
                      onChange={(k) => setNewSourceKey(k)}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                      <button type="button" className="dash-subtle" onClick={() => setAddingSource(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="dash-primary"
                        disabled={!newSourceKey}
                        onClick={() => void handleAddBrowserSource()}
                      >
                        Add Source
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(!project.sources || project.sources.length === 0) && (
                    <div style={{ padding: 16, border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                      Using default project token connection ({project.tokenSource}).
                    </div>
                  )}

                  {(project.sources ?? []).map((src) => (
                    <div key={src.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: 'var(--surface)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <SourceStatusBadge status={src.status ?? 'connected'} lastReadAt={src.lastReadAt} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                            {src.workspaceName === 'T0FJQUFLJ' ? 'excellencetech' : src.workspaceName === 'T0C6YS80MPZ' ? 'AgentWork' : (src.workspaceName || src.workspaceId)}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {src.kind === 'browser' ? 'Browser session' : 'Token'} · {src.channels.length} channels monitored
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {src.kind === 'browser' ? (
                          <>
                            <button
                              type="button"
                              className="dash-subtle"
                              disabled={scrapingSourceId === src.id || src.enabled === false}
                              style={{ fontSize: 12, padding: '4px 8px', color: '#22c55e' }}
                              onClick={() => void handleScrapeSource(src.id)}
                              title="Auto-discover and scrape all public & private channels in this workspace"
                            >
                              {scrapingSourceId === src.id ? 'Scraping…' : '🕷 Scrape'}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="dash-subtle"
                          style={{ fontSize: 12, padding: '4px 8px' }}
                          onClick={() => void handleToggleSourceEnabled(src.id, src.enabled !== false)}
                        >
                          {src.enabled !== false ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--danger)',
                            fontSize: 12,
                            cursor: 'pointer',
                            padding: '4px 8px'
                          }}
                          onClick={() => void handleRemoveSource(src.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Discovered Channels Checklist for Browser Source */}
                    {src.kind === 'browser' && src.channels && src.channels.length > 0 && (
                      <div
                        style={{
                          marginTop: -4,
                          marginBottom: 8,
                          padding: '12px 16px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '0 0 8px 8px',
                          border: '1px solid var(--border)',
                          borderTop: 'none'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                            Monitored Channels ({src.channels.filter((c) => c.enabled !== false).length}/{src.channels.length} active)
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Auto-discovered public &amp; private locked channels
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                          {src.channels.map((ch) => (
                            <label
                              key={ch.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12,
                                padding: '4px 8px',
                                background: ch.enabled !== false ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                                border: `1px solid ${ch.enabled !== false ? 'rgba(99, 102, 241, 0.3)' : 'var(--border)'}`,
                                borderRadius: 4,
                                cursor: 'pointer',
                                color: ch.enabled !== false ? 'var(--text)' : 'var(--text-muted)'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={ch.enabled !== false}
                                onChange={() => void handleToggleChannelEnabled(src.id, ch.id, ch.enabled !== false)}
                              />
                              <span>
                                {ch.isPrivate ? '🔒' : '#'} {ch.name || ch.id}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* TAB: CHANNELS */}
          {activeTab === 'channels' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Workspace &amp; channels</h4>
                  <p>
                    Connector: <b>{project.tokenSource === 'oauth' ? 'OAuth app' : 'manual token'}</b> ·{' '}
                    {project.teamName ?? project.teamId} ·{' '}
                    {project.monitors.map((m) => `#${m.channelName}`).join(', ') || 'no channels'}
                  </p>
                </header>
                {editWorkspace ? (
                  <DashboardWizard inline projectId={project.id} onDone={() => setEditWorkspace(false)} />
                ) : (
                  <button type="button" className="dash-subtle" onClick={() => setEditWorkspace(true)}>
                    Edit workspace &amp; channels
                  </button>
                )}
              </section>

              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Slack token &amp; permissions</h4>
                  <p>
                    Read-only here. Slack Chat reads history with this token; sending replies additionally
                    needs the <b>chat:write</b> scope.
                  </p>
                </header>
                {tokenStatus === null ? (
                  <p className="ws-settings-token-state">Checking token…</p>
                ) : (
                  <div className="ws-settings-token">
                    <p className="ws-settings-token-state">
                      {tokenStatus.connected ? (
                        <span className="ws-settings-token-dot ok" aria-hidden="true" />
                      ) : (
                        <span className="ws-settings-token-dot off" aria-hidden="true" />
                      )}
                      <b>
                        {tokenStatus.connected
                          ? tokenStatus.source === 'oauth'
                            ? 'Connected via OAuth app'
                            : 'Connected via manual token'
                          : 'Not connected'}
                      </b>
                      {tokenStatus.teamName ? ` · ${tokenStatus.teamName}` : ''}
                    </p>
                    {tokenStatus.maskedToken ? (
                      <p className="ws-settings-token-line">
                        Token:{' '}
                        <span className="proj-token-chip selectable">
                          {tokenStatus.maskedToken.replace(/[`'"]/g, '')}
                        </span>{' '}
                        (full token stays encrypted in this app)
                      </p>
                    ) : null}
                    {tokenStatus.scopes ? (
                      <p className="ws-settings-token-line">
                        Scopes: <code className="selectable">{tokenStatus.scopes.join(', ')}</code>
                      </p>
                    ) : tokenStatus.connected ? (
                      <p className="ws-settings-token-line">
                        Slack doesn&apos;t report scopes for this token type — sending is decided by the
                        token; errors surface when you send.
                      </p>
                    ) : null}
                    {tokenStatus.canSend === true ? (
                      <p className="ai-settings-notice">Sending is enabled — chat:write is granted.</p>
                    ) : null}
                    {tokenStatus.canSend === false ? (
                      <p className="ai-settings-error">
                        Read-only: this token is missing the <b>chat:write</b> scope, so Cosmic cannot post
                        replies. Add <b>chat:write</b> to the Slack app&apos;s User Token Scopes (OAuth
                        &amp; Permissions), reinstall or reconnect the workspace, then try again.
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB: SCHEDULE */}
          {activeTab === 'schedule' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section">
                <header className="ws-settings-head">
                  <h4>Schedule &amp; completion</h4>
                  <p>Manual values win over dates and percentages the AI finds in chat.</p>
                </header>
                <div className="ws-settings-grid">
                  <label className="ai-settings-field">
                    <span>Start date</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                  </label>
                  <label className="ai-settings-field">
                    <span>End date / deadline</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                  </label>
                  <label className="ai-settings-field">
                    <span>Completion % (0–100)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="auto"
                      value={completion}
                      onChange={(e) => {
                        setCompletion(e.target.value)
                        setScheduleNotice(null)
                      }}
                    />
                    <small style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Leave empty to auto-calculate from project activity.
                    </small>
                  </label>
                </div>
                {scheduleError ? <p className="ai-settings-error">{scheduleError}</p> : null}
                {scheduleNotice ? <p className="ai-settings-notice">{scheduleNotice}</p> : null}
                <div className="ai-settings-actions" style={{ marginTop: '16px' }}>
                  <button
                    type="button"
                    className="dash-primary"
                    disabled={scheduleSaving || !isScheduleChanged}
                    onClick={() => void saveSchedule()}
                  >
                    {scheduleSaving ? 'Saving…' : 'Save schedule'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* TAB: SIDEBAR LAYOUT */}
          {activeTab === 'sidebar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                <SidebarLayoutView
                  layout={layout}
                  onModeChange={handleModeChange}
                  onToggleSection={handleToggleSection}
                  onReset={handleResetLayout}
                />

                {/* 1. Card Sidebar Buttons & Footer */}
                <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                    Card Sidebar Buttons & Footer
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={layout.custom.hideAddButton === false}
                        onChange={handleToggleHideAddButton}
                      />
                      <span><b>Show "+ Add" button</b> in this card's sidebar footer (alongside Settings)</span>
                    </label>
                  </div>
                </div>

                {/* 2. Global Accounts Section (sidebar-acc-global-accounts) */}
                <div
                  id="sidebar-acc-global-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        🌐 Global Accounts (sidebar-acc-global-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Global workspaces &amp; links. Only <b>Active</b> accounts are accessible to this card &amp; its AI agent.
                      </p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                      <input
                        type="checkbox"
                        checked={!layout.custom.hiddenItems?.['slack']?.includes('global_accounts')}
                        onChange={() => handleToggleSubItem('slack', 'global_accounts')}
                      />
                      <span>Show in sidebar</span>
                    </label>
                  </div>

                  {/* List of profiles, their workspaces & links */}
                  {profiles.length === 0 ? (
                    <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                      No global profiles configured yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {profiles.map((p) => {
                        const pName = p.customName || p.displayName
                        const customLinks = p.customLinks ?? []
                        const slackWorkspaces = p.apps?.slack?.availableWorkspaces ?? []

                        // Across all profiles for bulk actions
                        const allGlobalItemIds = profiles.flatMap((prof) => [
                          ...(prof.apps?.slack?.availableWorkspaces ?? []).map((w) => `ws:${prof.id}:${w.teamId}`),
                          ...(prof.customLinks ?? []).map((l) => l.id)
                        ])

                        const active = layout.custom.activeGlobalItems
                        const allowed = layout.custom.allowedGlobalLinks

                        return (
                          <div
                            key={p.id}
                            style={{
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 8,
                              padding: '14px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                  👤 {pName}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        activeGlobalItems: allGlobalItemIds,
                                        allowedGlobalLinks: allGlobalItemIds
                                      }
                                    })
                                  }}
                                  title="Activate and show all workspaces and links for this card"
                                >
                                  Activate All
                                </button>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        allowedGlobalLinks: []
                                      }
                                    })
                                  }}
                                  title="Hide all global workspaces and links from this card's sidebar"
                                >
                                  Hide All
                                </button>
                                <button
                                  type="button"
                                  className="dash-subtle"
                                  style={{ fontSize: 11, padding: '2px 8px', color: 'var(--danger)' }}
                                  onClick={() => {
                                    updateLayout({
                                      ...layout,
                                      custom: {
                                        ...layout.custom,
                                        activeGlobalItems: [],
                                        allowedGlobalLinks: []
                                      }
                                    })
                                  }}
                                  title="Deactivate all global accounts for this card (No AI / No sidebar access)"
                                >
                                  Deactivate All
                                </button>
                              </div>
                            </div>

                            {/* Workspaces Section with Active / Deactive & Show / Hide controls */}
                            {slackWorkspaces.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 650, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                  Slack Workspaces
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                                  {slackWorkspaces.map((w) => {
                                    const wsKey = `ws:${p.id}:${w.teamId}`
                                    const isActive = active === undefined ? true : active.includes(wsKey)
                                    const isShown = allowed === undefined ? true : allowed.includes(wsKey)

                                    return (
                                      <div
                                        key={w.teamId}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 10px',
                                          borderRadius: 6,
                                          background: !isActive
                                            ? 'rgba(0, 0, 0, 0.4)'
                                            : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                          border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                          gap: 8,
                                          opacity: !isActive ? 0.6 : 1
                                        }}
                                      >
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#fff' : '#64748b' }}>
                                            🏢 {w.teamName}
                                          </div>
                                          <div style={{ fontSize: 10, color: '#64748b' }}>Slack Workspace</div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                          {/* 1. Active / Deactive Toggle Button */}
                                          <button
                                            type="button"
                                            className="dash-subtle"
                                            style={{
                                              fontSize: 10.5,
                                              padding: '2px 6px',
                                              color: isActive ? '#22c55e' : '#94a3b8'
                                            }}
                                            onClick={() => handleToggleActiveGlobalItem(wsKey, allGlobalItemIds)}
                                            title={isActive ? 'Click to deactivate for this card and AI' : 'Click to activate for this card'}
                                          >
                                            {isActive ? '⚡ Active' : '⏸ Inactive'}
                                          </button>

                                          {/* 2. Show / Hide (only when Active) */}
                                          {isActive && (
                                            <>
                                              <button
                                                type="button"
                                                className="dash-subtle"
                                                style={{
                                                  fontSize: 10.5,
                                                  padding: '2px 6px',
                                                  color: isShown ? 'var(--accent-btn)' : '#94a3b8'
                                                }}
                                                onClick={() => handleToggleAllowedGlobalLink(wsKey, allGlobalItemIds)}
                                                title={isShown ? 'Hide from this card sidebar' : 'Show in this card sidebar'}
                                              >
                                                {isShown ? '👁 Shown' : '👁‍🗨 Hidden'}
                                              </button>
                                              {isShown && (
                                                <button
                                                  type="button"
                                                  style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--danger)',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    padding: '2px 4px'
                                                  }}
                                                  onClick={() => handleToggleAllowedGlobalLink(wsKey, allGlobalItemIds)}
                                                  title="Remove from sidebar"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Links list with Active / Deactive & Show / Hide controls */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 650, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                                Custom Tabs &amp; AI Agents
                              </div>
                              {customLinks.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  No custom links added to this profile.
                                </p>
                              ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                                  {customLinks.map((link) => {
                                    const isActive = active === undefined ? true : active.includes(link.id)
                                    const isShown = allowed === undefined ? true : allowed.includes(link.id)

                                    return (
                                      <div
                                        key={link.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '8px 10px',
                                          borderRadius: 6,
                                          background: !isActive
                                            ? 'rgba(0, 0, 0, 0.4)'
                                            : isShown ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                          border: `1px solid ${!isActive ? 'rgba(255, 255, 255, 0.04)' : isShown ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.06)'}`,
                                          gap: 8,
                                          opacity: !isActive ? 0.6 : 1
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 500,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            color: isActive ? (isShown ? 'var(--text)' : 'var(--text-muted)') : '#64748b'
                                          }}
                                          title={`${link.name}: ${link.url}`}
                                        >
                                          🔗 {link.name}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                          {/* 1. Active / Deactive Toggle Button */}
                                          <button
                                            type="button"
                                            className="dash-subtle"
                                            style={{
                                              fontSize: 10.5,
                                              padding: '2px 6px',
                                              color: isActive ? '#22c55e' : '#94a3b8'
                                            }}
                                            onClick={() => handleToggleActiveGlobalItem(link.id, allGlobalItemIds)}
                                            title={isActive ? 'Click to deactivate for this card and AI' : 'Click to activate for this card'}
                                          >
                                            {isActive ? '⚡ Active' : '⏸ Inactive'}
                                          </button>

                                          {/* 2. Show / Hide (only when Active) */}
                                          {isActive && (
                                            <>
                                              <button
                                                type="button"
                                                className="dash-subtle"
                                                style={{
                                                  fontSize: 10.5,
                                                  padding: '2px 6px',
                                                  color: isShown ? 'var(--accent-btn)' : 'var(--text-muted)'
                                                }}
                                                onClick={() => handleToggleAllowedGlobalLink(link.id, allGlobalItemIds)}
                                                title={isShown ? 'Hide from this card sidebar' : 'Show in this card sidebar'}
                                              >
                                                {isShown ? '👁 Shown' : '👁‍🗨 Hidden'}
                                              </button>
                                              {isShown && (
                                                <button
                                                  type="button"
                                                  style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--danger)',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    padding: '2px 4px'
                                                  }}
                                                  onClick={() => handleToggleAllowedGlobalLink(link.id, allGlobalItemIds)}
                                                  title="Remove from this card sidebar"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 3. My Accounts Section (sidebar-acc-my-accounts) */}
                <div
                  id="sidebar-acc-my-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        👤 My Accounts (sidebar-acc-my-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Internal team workspaces, platforms (Discord, Upwork, Teams), and custom links.
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                        <input
                          type="checkbox"
                          checked={!layout.custom.hiddenItems?.['slack']?.includes('our_slack')}
                          onChange={() => handleToggleSubItem('slack', 'our_slack')}
                        />
                        <span>Show in sidebar</span>
                      </label>
                      <button
                        type="button"
                        className="dash-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          setCardAddModalTab('my')
                          setCardAddModalOpen(true)
                        }}
                      >
                        + Add Platform / Link
                      </button>
                    </div>
                  </div>

                  {/* Sources belonging to 'ours' */}
                  {(() => {
                    const mySources = (project.sources ?? []).filter((s) => s.role === 'ours')
                    if (mySources.length === 0) {
                      return (
                        <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          No custom sources added under My Accounts yet. Click "+ Add Platform / Link" to attach one.
                        </div>
                      )
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {mySources.map((src) => (
                          <div
                            key={src.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 6,
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 14 }}>{src.url ? '🌐' : '🔌'}</span>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                  {src.workspaceName}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                  {src.url ? src.url : (src.platform ?? 'channel')}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                className="dash-subtle"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => void handleToggleSourceEnabled(src.id, src.enabled !== false)}
                              >
                                {src.enabled !== false ? '👁 Active' : '👁‍🗨 Paused'}
                              </button>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  padding: '3px 6px'
                                }}
                                onClick={() => void handleRemoveSource(src.id)}
                                title="Remove from this card"
                              >
                                ✕ Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* 4. Client Accounts Section (sidebar-acc-client-accounts) */}
                <div
                  id="sidebar-acc-client-accounts"
                  style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 650, color: 'var(--text)' }}>
                        🤝 Client Accounts (sidebar-acc-client-accounts)
                      </h4>
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                        Client communications, direct workspace tokens, or external client portals.
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '12.5px' }}>
                        <input
                          type="checkbox"
                          checked={!layout.custom.hiddenItems?.['slack']?.includes('client_slack')}
                          onChange={() => handleToggleSubItem('slack', 'client_slack')}
                        />
                        <span>Show in sidebar</span>
                      </label>
                      <button
                        type="button"
                        className="dash-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => {
                          setCardAddModalTab('client')
                          setCardAddModalOpen(true)
                        }}
                      >
                        + Add Platform / Link
                      </button>
                    </div>
                  </div>

                  {/* Sources belonging to 'client' */}
                  {(() => {
                    const clientSources = (project.sources ?? []).filter((s) => s.role === 'client')
                    if (clientSources.length === 0) {
                      return (
                        <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          No client sources added yet. Click "+ Add Platform / Link" to connect one.
                        </div>
                      )
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {clientSources.map((src) => (
                          <div
                            key={src.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 6,
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: '1px solid rgba(255, 255, 255, 0.06)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 14 }}>{src.url ? '🌐' : '🔌'}</span>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                  {src.workspaceName}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                  {src.url ? src.url : (src.platform ?? 'channel')}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                className="dash-subtle"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => void handleToggleSourceEnabled(src.id, src.enabled !== false)}
                              >
                                {src.enabled !== false ? '👁 Active' : '👁‍🗨 Paused'}
                              </button>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  padding: '3px 6px'
                                }}
                                onClick={() => void handleRemoveSource(src.id)}
                                title="Remove from this card"
                              >
                                ✕ Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </section>
            </div>
          )}

          {/* TAB: DANGER ZONE */}
          {activeTab === 'danger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <section className="ws-settings-section is-danger">
                <header className="ws-settings-head">
                  <h4 style={{ color: 'var(--danger)' }}>Danger zone</h4>
                  <p>Irreversible actions for this project card.</p>
                </header>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--text)', margin: 0 }}>
                    Deleting this card will stop all automated syncing, clear its insight cache, and remove it from the dashboard.
                  </p>
                  {confirmDelete ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        type="button"
                        style={{
                          background: 'var(--danger)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '10px 16px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                        onClick={() => void handleDeleteProject()}
                        data-testid="confirm-delete-project"
                      >
                        Yes, permanently delete {project.name}
                      </button>
                      <button
                        type="button"
                        className="dash-subtle"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          color: 'var(--danger)',
                          border: '1px solid var(--danger)',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        onClick={() => setConfirmDelete(true)}
                        data-testid="delete-project-btn"
                      >
                        Delete this project
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <footer className="ws-settings-footer" data-testid="settings-footer">
          <div className="ws-settings-footer-left">
            {isScheduleChanged && activeTab === 'schedule' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)' }}>
                <span className="ws-settings-unsaved-dot" />
                <span>Unsaved changes</span>
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                Settings are saved per section.
              </span>
            )}
          </div>
          <div className="ws-settings-footer-right">
            {activeTab === 'schedule' ? (
              <button
                type="button"
                className="dash-primary"
                disabled={scheduleSaving || !isScheduleChanged}
                onClick={() => void saveSchedule()}
              >
                {scheduleSaving ? 'Saving…' : 'Save schedule'}
              </button>
            ) : null}
          </div>
        </footer>
      </div>

      <RunLogsModal
        open={logsOpen}
        projectId={project.id}
        projectName={project.name}
        onClose={() => setLogsOpen(false)}
      />

      <CardAddModal
        open={cardAddModalOpen}
        project={project}
        defaultTab={cardAddModalTab}
        onClose={() => setCardAddModalOpen(false)}
        onSuccess={() => setCardAddModalOpen(false)}
      />
    </div>
  )
}
