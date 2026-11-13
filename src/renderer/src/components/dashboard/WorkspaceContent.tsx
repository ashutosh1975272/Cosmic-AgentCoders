import React, { useState, useEffect, useMemo } from 'react'
import type { CardView, CardSummary } from './card-view'
import type {
  DashboardProject,
  DashboardProjectSnapshot,
  ProjectSource
} from '../../../../shared/dashboard-contract'
import CentreContent from './CentreContent'
import CentreVisuals from './CentreVisuals'
import DashboardPage from './DashboardPage'
import NavIcon from './nav-icons'
import { DetailBody, GuideDetailBody } from './guide-content'
import SlackChatTab from './SlackChatTab'
import CardLiveSlackEmbed from './CardLiveSlackEmbed'
import CardLiveWebEmbed from './CardLiveWebEmbed'
import ProjectSettingsTab from './ProjectSettingsTab'
import AgentChatPanel from './AgentChatPanel'
import { requestMessageJump } from './jump-to-message'
import SchedulesPage from './SchedulesPage'
import { SourceChannelPicker } from './SourceChannelPicker'
import { PlatformThinBar } from '../../platforms/components/PlatformThinBar'
import { PlatformControlModal } from '../../platforms/components/PlatformControlModal'
import { useProfileStore } from '../../hooks/useProfiles'
import { useDashboardStore } from '../../hooks/useDashboard'
import { BASE_APP_PRESETS } from '../../../../shared/base-app-presets'
import {
  channelIdOf,
  connectorOf,
  connectorOfSelection,
  detailKeyOf,
  guideSectionOf,
  isChannelId,
  isDetailId,
  isGlobalWorkspaceId,
  isGuideId,
  isVisualId,
  isSocialChatId,
  socialSourceIdOf,
  navRowOf,
  slackSourceOf,
  visualKeyOf,
  xomniModeOf,
  type ConnectorChannelLists,
  type OpenGroup,
  type SelectionId,
  type WorkspaceNavState
} from './workspace-nav'

interface WorkspaceContentProps {
  view: CardView
  summary: CardSummary
  project: DashboardProject
  snapshot: DashboardProjectSnapshot
  nav: WorkspaceNavState
  channels: ConnectorChannelLists
  syncing: boolean
  onSync: () => void
  onOpenSettings: () => void
  onSelect: (selection: SelectionId) => void
  /** Dashboard overview → chat hand-off. */
  chatDraft?: string | null
  onConsumeChatDraft?: () => void
}

/** Headings for the bodies no row owns. */
const GROUP_META: Record<OpenGroup, { title: string; desc: string }> = {
  dash: { title: 'Dashboard', desc: 'Everything about this project at a glance.' },
  xomni: { title: 'Xomni', desc: 'Chat with this project.' },
  slack: {
    title: 'Connect channel',
    desc: 'Messages from Our Slack and the client’s Slack workspace.'
  },
  info: { title: 'Project info', desc: 'What this card has learned about the project.' },
  viz: { title: 'Visualizations', desc: 'Charts built from this project’s own numbers.' },
  settings: { title: 'Settings', desc: 'Model, key, channels and dates for this card.' }
}

function panelMeta(
  nav: WorkspaceNavState,
  channels: ConnectorChannelLists
): { title: string; desc: string } {
  const sel = nav.selection
  if (sel && isChannelId(sel)) {
    const key = connectorOfSelection(sel)
    const connector = connectorOf(key)
    const id = channelIdOf(sel)
    const entry = channels[key ?? 'client']?.entries.find((ch) => ch.id === id)
    return {
      title: entry ? `#${entry.name}` : (connector?.label ?? 'Channels'),
      desc: 'One channel from this connector. Replies post here.'
    }
  }
  // A connector's whole-workspace row is named "All channels" in the dropdown,
  // which only reads clearly next to the connector's own label.
  if (sel && sel.startsWith('s:')) {
    const connector = connectorOf(connectorOfSelection(sel))
    if (connector) return { title: `All of ${connector.label}`, desc: connector.note }
  }
  const row = navRowOf(nav.selection)
  if (row) return { title: row.label, desc: row.desc }
  return GROUP_META[nav.openGroup]
}

export default function WorkspaceContent({
  view,
  summary,
  project,
  snapshot,
  nav,
  channels,
  syncing,
  onSync,
  onOpenSettings,
  onSelect,
  chatDraft,
  onConsumeChatDraft
}: WorkspaceContentProps): React.ReactElement {
  const { centre, leftSidebar, rightSidebar, identity } = view
  const { title, desc } = panelMeta(nav, channels)
  const sel = nav.selection

  const profiles = useProfileStore((s) => s.profiles)
  const targetProfile = profiles.find((p) => p.id === project.profileId) ?? profiles[0]

  const [authBusyApp, setAuthBusyApp] = useState<'slack' | 'teams' | 'whatsapp' | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [slackViewMode, setSlackViewMode] = useState<'messages' | 'live'>('live')
  const [cardAuthenticated, setCardAuthenticated] = useState<boolean | null>(null)
  const [cardAuth, setCardAuth] = useState<{
    slack: boolean | null
    teams: boolean | null
    whatsapp: boolean | null
  }>({
    slack: null,
    teams: null,
    whatsapp: null
  })
  const [channelPickerSourceId, setChannelPickerSourceId] = useState<string | null>(null)
  const [controlSource, setControlSource] = useState<ProjectSource | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!project?.id) return

    const checkAll = async () => {
      try {
        const [slackAuth, teamsAuth, whatsappAuth] = await Promise.all([
          window.api?.dashboard?.checkCardAuth?.({ projectId: project.id, appId: 'slack' }).catch(() => false),
          window.api?.dashboard?.checkCardAuth?.({ projectId: project.id, appId: 'teams' }).catch(() => false),
          window.api?.dashboard?.checkCardAuth?.({ projectId: project.id, appId: 'whatsapp' }).catch(() => false)
        ])
        if (!cancelled) {
          setCardAuth({
            slack: Boolean(slackAuth),
            teams: Boolean(teamsAuth),
            whatsapp: Boolean(whatsappAuth)
          })
          setCardAuthenticated(Boolean(slackAuth))
        }
      } catch {
        if (!cancelled) {
          setCardAuth({ slack: false, teams: false, whatsapp: false })
          setCardAuthenticated(false)
        }
      }
    }

    void checkAll()
    return () => {
      cancelled = true
    }
  }, [project?.id, authBusyApp])

  useEffect(() => {
    if (nav.selection !== 'm:schedules') return
    const scheduled = (project.sources ?? []).some(
      (source) =>
        source.kind === 'browser' && source.enabled !== false && source.scheduleEnabled === true
    )
    if (!scheduled) onSelect('m:project')
  }, [nav.selection, project.sources, onSelect])




  const slackBrowserSource = useMemo(
    () =>
      (project.sources ?? []).find(
        (source) => source.kind === 'browser' && source.enabled !== false
      ) ?? null,
    [project.sources]
  )

  const teamsSource = useMemo(
    () =>
      (project.sources ?? []).find(
        (source) => source.platform === 'teams' && source.enabled !== false
      ) ?? null,
    [project.sources]
  )

  const effectiveTeamsSource: ProjectSource = useMemo(() => {
    if (teamsSource) {
      return {
        ...teamsSource,
        channels: (teamsSource.channels ?? []).filter(
          (c) => !c.id.startsWith('C') && !c.id.startsWith('U') && !c.name.startsWith('#')
        )
      }
    }
    const prof = targetProfile ?? profiles.find((p) => p.id === project.profileId)
    const nowIso = new Date().toISOString()
    return {
      id: `src-${project.id}-teams`,
      workspaceName: 'Microsoft Teams',
      kind: 'browser',
      platform: 'teams',
      profileId: prof?.id ?? project.profileId,
      workspaceId: prof?.apps?.teams?.availableWorkspaces?.[0]?.teamId ?? 'teams-home',
      channels: [],
      role: 'client',
      backfillDays: 30,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  }, [teamsSource, targetProfile, profiles, project])

  const whatsappSource = useMemo(
    () =>
      (project.sources ?? []).find(
        (source) => source.platform === 'whatsapp' && source.enabled !== false
      ) ?? null,
    [project.sources]
  )

  const effectiveWhatsAppSource: ProjectSource = useMemo(() => {
    if (whatsappSource) {
      return {
        ...whatsappSource,
        channels: (whatsappSource.channels ?? []).filter(
          (c) => !c.id.startsWith('C') && !c.id.startsWith('U') && !c.name.startsWith('#')
        )
      }
    }
    const prof = targetProfile ?? profiles.find((p) => p.id === project.profileId)
    const nowIso = new Date().toISOString()
    return {
      id: `src-${project.id}-whatsapp`,
      workspaceName: 'WhatsApp Web',
      kind: 'browser',
      platform: 'whatsapp',
      profileId: prof?.id ?? project.profileId,
      workspaceId: 'whatsapp-web',
      channels: [],
      role: 'client',
      backfillDays: 30,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  }, [whatsappSource, targetProfile, profiles, project])

  // Resolve genuine Slack team ID strictly for THIS card / profile, without cross-profile leakage
  const effectiveSlackTeamId = useMemo(() => {
    if (project?.teamId && /^T[A-Z0-9]+$/i.test(project.teamId)) {
      return project.teamId
    }
    const realWs = targetProfile?.apps?.slack?.availableWorkspaces?.find(
      (w) => w.teamId && /^T[A-Z0-9]+$/i.test(w.teamId)
    )
    if (realWs?.teamId) {
      return realWs.teamId
    }
    return ''
  }, [project?.teamId, targetProfile])

  // Auto-heal project teamId if placeholder
  useEffect(() => {
    if (!project || !effectiveSlackTeamId) return
    const isPlaceholder = !project.teamId || !/^T[A-Z0-9]+$/i.test(project.teamId)
    if (isPlaceholder && effectiveSlackTeamId) {
      const realWs = targetProfile?.apps?.slack?.availableWorkspaces?.find(
        (w) => w.teamId === effectiveSlackTeamId
      )
      void window.api?.dashboard?.upsertProject?.({
        project: {
          ...project,
          teamId: effectiveSlackTeamId,
          teamName: realWs?.teamName || project.teamName || 'Slack Workspace'
        }
      }).then(() => {
        void useDashboardStore.getState().loadSnapshot()
      }).catch(() => undefined)
    }
  }, [project?.id, project?.teamId, effectiveSlackTeamId, targetProfile])

  const isEmbedActive = useMemo(() => {
    if (nav.openGroup !== 'slack') return false
    if (channelPickerSourceId || controlSource) return false
    if (!sel) {
      return (
        slackViewMode === 'live' &&
        Boolean(cardAuthenticated === true || effectiveSlackTeamId || project.teamId || channels.teamConnected)
      )
    }
    if (sel.startsWith('c:teams') || sel.startsWith('c:whatsapp')) return true
    if (sel.startsWith('c:preset:') || sel.startsWith('c:link:') || sel.startsWith('c:custom:')) return true
    if (isGlobalWorkspaceId(sel)) return true
    const isWholeWorkspace = sel === 's:team' || sel === 's:client' || !isChannelId(sel)
    if (isWholeWorkspace && slackViewMode === 'live') {
      return Boolean(cardAuthenticated === true || effectiveSlackTeamId || project.teamId || channels.teamConnected)
    }
    return false
  }, [
    nav.openGroup,
    sel,
    channelPickerSourceId,
    controlSource,
    slackViewMode,
    cardAuthenticated,
    effectiveSlackTeamId,
    project.teamId,
    channels.teamConnected
  ])

  useEffect(() => {
    if (nav.openGroup === 'dash' || !isEmbedActive) {
      void window.api?.profiles?.setEmbedVisible?.(false)
      void window.api?.profiles?.clearCardSlackEmbed?.()
    } else {
      void window.api?.profiles?.setEmbedVisible?.(true)
    }
  }, [nav.openGroup, sel, channelPickerSourceId, controlSource, isEmbedActive])

  const handleStartCardAppLogin = async (
    projectId?: string,
    profileId?: string,
    appId?: 'slack' | 'teams' | 'whatsapp'
  ) => {
    if (!projectId || !profileId || !appId) return
    setAuthBusyApp(appId)
    setAuthError(null)
    try {
      if (window.api?.profiles?.startCardAppLogin) {
        await window.api.profiles.startCardAppLogin({
          projectId,
          profileId,
          appId
        })
        const isAuth = await window.api.dashboard.checkCardAuth({ projectId, appId })
        setCardAuth((prev) => ({ ...prev, [appId]: Boolean(isAuth) }))
        if (appId === 'slack') {
          setCardAuthenticated(Boolean(isAuth))
        }
        if (isAuth) {
          await useDashboardStore.getState().loadSnapshot()
          const currentProject =
            useDashboardStore
              .getState()
              .snapshot?.projects.find((p) => p.project.id === projectId)?.project ?? project
          let existingSource = (currentProject.sources ?? []).find(
            (s) => s.kind === 'browser' && s.platform === appId && s.enabled !== false
          )
          if (!existingSource) {
            const now = new Date().toISOString()
            const newSourceId = `src-${appId}-${Date.now()}`
            const defaultWsName =
              appId === 'teams' ? 'Microsoft Teams' : appId === 'whatsapp' ? 'WhatsApp' : 'Slack Workspace'
            const newSource: ProjectSource = {
              id: newSourceId,
              kind: 'browser',
              platform: appId,
              profileId,
              workspaceId: appId === 'slack' ? (effectiveSlackTeamId || currentProject.teamId || 'team') : appId,
              workspaceName: currentProject.teamName || defaultWsName,
              channels: [],
              role: 'client',
              enabled: true,
              backfillDays: 7,
              status: 'connected',
              selectionMode: 'include',
              createdAt: now,
              updatedAt: now
            }
            existingSource = newSource
            await useDashboardStore.getState().upsertProject({
              ...currentProject,
              sources: [...(currentProject.sources ?? []), newSource]
            })
            await useDashboardStore.getState().loadSnapshot()
          }
          if (existingSource && !existingSource.channelsReviewedAt) {
            setChannelPickerSourceId(existingSource.id)
          }
        }
      }
    } catch (err) {
      console.error('Card app login error', err)
      setAuthError(String(err))
    } finally {
      setAuthBusyApp(null)
    }
  }

  const primarySource =
    (project.sources ?? []).find((s) => s.platform === 'slack' && s.enabled !== false) ||
    project.sources?.[0] ||
    null

  const controlModalElement = (
    <PlatformControlModal
      open={Boolean(controlSource)}
      project={project}
      source={controlSource}
      onClose={() => setControlSource(null)}
      onSaved={() => {
        void useDashboardStore.getState().loadSnapshot()
      }}
    />
  )

  // Dashboard brings its own scroll surface and width; the generic panel header
  // would repeat the project name above the freshness line.
  if (nav.openGroup === 'dash') {
    return (
      <section className="ws-content is-bare" aria-label="Dashboard">
        <DashboardPage
          view={view}
          summary={summary}
          project={project}
          snapshot={snapshot}
          syncing={syncing}
          onSync={onSync}
          onOpenSettings={onOpenSettings}
          onSelect={onSelect}
          onOpenControl={() => {
            if (primarySource) setControlSource(primarySource)
            else onOpenSettings()
          }}
        />
        {controlModalElement}
      </section>
    )
  }

  let body: React.ReactNode
  let bare = false

  if (nav.openGroup === 'xomni') {
    if (xomniModeOf(nav) === 'schedules') {
      body = <SchedulesPage />
    } else if (nav.selection && isSocialChatId(nav.selection)) {
      const sourceId = socialSourceIdOf(nav.selection)
      const targetSource = (project.sources ?? []).find((s) => s.id === sourceId) ?? null
      body = (
        <AgentChatPanel
          key={`${summary.projectId}:${sourceId}`}
          projectName={identity.name}
          projectId={summary.projectId}
          mode="social"
          socialSource={targetSource}
          sources={project.sources}
          initialQuestion={chatDraft}
          onConsumeInitial={onConsumeChatDraft}
          onOpenSettings={onOpenSettings}
          onOpenControl={() => {
            if (targetSource) setControlSource(targetSource)
            else if (primarySource) setControlSource(primarySource)
          }}
          onOpenLiveEmbed={() => {
            if (targetSource?.profileId && targetSource?.workspaceId) {
              onSelect(`w:${targetSource.profileId}:${targetSource.workspaceId}` as SelectionId)
            } else {
              onSelect('s:client')
            }
          }}
          onOpenSource={(ref) => {
            requestMessageJump({
              projectId: summary.projectId,
              source: ref.source,
              channelId: ref.channelId,
              ts: ref.ts
            })
            onSelect(
              `c:${ref.source === 'ours' ? 'team' : 'client'}:${ref.channelId}` as SelectionId
            )
          }}
        />
      )
      bare = true
    } else {
      body = (
        <AgentChatPanel
          key={summary.projectId}
          projectName={identity.name}
          projectId={summary.projectId}
          mode={xomniModeOf(nav)}
          sources={project.sources}
          initialQuestion={chatDraft}
          onConsumeInitial={onConsumeChatDraft}
          onOpenSettings={onOpenSettings}
          onOpenControl={() => {
            if (primarySource) setControlSource(primarySource)
          }}
          onOpenSource={(ref) => {
            // Always navigate to the channel; the Slack tab consumes this
            // target and scrolls/flashes when the message is loaded.
            requestMessageJump({
              projectId: summary.projectId,
              source: ref.source,
              channelId: ref.channelId,
              ts: ref.ts
            })
            onSelect(
              `c:${ref.source === 'ours' ? 'team' : 'client'}:${ref.channelId}` as SelectionId
            )
          }}
        />
      )
      bare = true
    }
  } else if (nav.openGroup === 'slack') {
    if (sel && isGlobalWorkspaceId(sel)) {
      // Global workspace selected: mount real live Slack WebContentsView inside this card
      const [, pId, tId] = sel.split(':')
      const targetP = profiles.find((p) => p.id === pId)
      const targetWs = targetP?.apps?.slack?.availableWorkspaces?.find((w) => w.teamId === tId)
      const wsName = targetWs?.teamName || tId
      const matchingSource = (project.sources ?? []).find(
        (s) => s.profileId === pId && s.workspaceId === tId && s.enabled !== false
      )

      body = (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, background: 'var(--bg-page)' }}>
          <PlatformThinBar
            platform="slack"
            workspaceName="Slack Workspace"
            subtitle={wsName}
            isConnected={true}
            channelCount={matchingSource?.channels?.filter((c) => c.enabled !== false).length ?? 0}
            onOpenControl={() => matchingSource && setControlSource(matchingSource)}
            onReauthenticate={() => void handleStartCardAppLogin(project.id, pId, 'slack')}
          />
          <div style={{ flex: '1 1 0%', minHeight: 0, height: '100%', width: '100%', position: 'relative' }}>
            <CardLiveSlackEmbed
              key={`global-embed:${pId}:${tId}`}
              profileId={pId}
              teamId={tId}
              appId="slack"
              hidden={Boolean(channelPickerSourceId)}
            />
          </div>
        </div>
      )
    } else if (sel && (sel.startsWith('c:preset:') || sel.startsWith('c:link:') || sel.startsWith('c:custom:'))) {
      let url = 'https://google.com'
      let name = 'Web Tool'
      let icon = '🌐'
      let linkKey: string = sel

      if (sel.startsWith('c:preset:')) {
        const presetId = sel.replace('c:preset:', '')
        linkKey = presetId
        const presetItem = BASE_APP_PRESETS.full.find((p) => p.id === presetId)
        url = presetItem?.url || 'https://google.com'
        name = presetItem?.name || presetId
        icon = presetItem?.icon || '🌐'
      } else {
        const linkId = sel.replace(/^c:(link|custom):/, '')
        linkKey = linkId
        const found = (targetProfile?.customLinks ?? []).find((l) => l.id === linkId)
        if (found) {
          url = found.url
          name = found.name
          icon = '🔗'
        }
      }

      const handleReload = () => {
        void window.api?.profiles?.reloadCardEmbed?.()
      }

      body = (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, background: 'var(--bg-page)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span style={{ fontWeight: 650, color: '#f8fafc' }}>{name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>· {url}</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#4ade80',
                background: 'rgba(74, 222, 128, 0.1)',
                padding: '2px 7px',
                borderRadius: 12,
                fontWeight: 600
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                Web Tool
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={handleReload}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  fontSize: 11,
                  borderRadius: 6,
                  padding: '3px 9px',
                  cursor: 'pointer'
                }}
                title="Reload page"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => window.open(url, '_blank')}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  fontSize: 11,
                  borderRadius: 6,
                  padding: '3px 9px',
                  cursor: 'pointer'
                }}
                title="Open in external browser"
              >
                Open in Browser ↗
              </button>
            </div>
          </div>
          <div style={{ flex: '1 1 0%', minHeight: 0, height: '100%', width: '100%', position: 'relative' }}>
            <CardLiveWebEmbed
              projectId={project.id}
              profileId={targetProfile?.id}
              linkId={linkKey}
              url={url}
              hidden={Boolean(channelPickerSourceId)}
            />
          </div>
        </div>
      )
    } else if (sel && sel.startsWith('c:teams')) {
      const isConnected =
        cardAuth.teams === true ||
        (cardAuth.teams === null && targetProfile?.apps?.teams?.sessionStatus === 'signed-in') ||
        teamsSource?.status === 'connected'
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, background: 'var(--bg-page)' }}>
          <PlatformThinBar
            platform="teams"
            workspaceName="Microsoft Teams"
            subtitle={targetProfile?.displayName}
            isConnected={isConnected}
            channelCount={effectiveTeamsSource.channels.filter((c) => c.enabled !== false).length}
            onOpenControl={() => setControlSource(effectiveTeamsSource)}
            onReauthenticate={() => void handleStartCardAppLogin(project.id, targetProfile?.id, 'teams')}
          />
          <div style={{ flex: '1 1 0%', minHeight: 0, width: '100%', position: 'relative', overflow: 'hidden' }}>
            <CardLiveSlackEmbed
              key={`live-embed-teams-${project.id}`}
              appId="teams"
              projectId={project.id}
              profileId={targetProfile?.id}
              hidden={Boolean(channelPickerSourceId) || Boolean(controlSource)}
            />
          </div>
        </div>
      )
    } else if (sel && sel.startsWith('c:whatsapp')) {
      const isConnected =
        cardAuth.whatsapp === true ||
        (cardAuth.whatsapp === null && targetProfile?.apps?.whatsapp?.sessionStatus === 'signed-in') ||
        effectiveWhatsAppSource?.status === 'connected'
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, background: '#111b21' }}>
          <PlatformThinBar
            platform="whatsapp"
            workspaceName="WhatsApp Web"
            subtitle={targetProfile?.displayName}
            isConnected={isConnected}
            channelCount={effectiveWhatsAppSource.channels.filter((c) => c.enabled !== false).length}
            onOpenControl={() => setControlSource(effectiveWhatsAppSource)}
            onReauthenticate={() => void handleStartCardAppLogin(project.id, targetProfile?.id, 'whatsapp')}
          />
          <div style={{ flex: '1 1 0%', minHeight: 0, width: '100%', position: 'relative', overflow: 'hidden' }}>
            <CardLiveSlackEmbed
              key={`live-embed-whatsapp-${project.id}`}
              appId="whatsapp"
              projectId={project.id}
              profileId={targetProfile?.id}
              hidden={Boolean(channelPickerSourceId) || Boolean(controlSource)}
            />
          </div>
        </div>
      )
    } else if (
      cardAuthenticated === false ||
      (cardAuthenticated === null && !channels.teamConnected && targetProfile?.apps?.slack?.sessionStatus === 'not-signed-in')
    ) {
      body = (
        <div className="ws-agent" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div className="ws-agent-empty" style={{ maxWidth: 440, padding: 24, textAlign: 'center' }}>
            <span className="ws-agent-empty-icon" style={{ display: 'inline-flex', padding: 12, background: 'rgba(234, 179, 8, 0.15)', borderRadius: 16 }}>
              <NavIcon name="slack" />
            </span>
            <h3 style={{ margin: '14px 0 6px', fontSize: 18, color: '#f8fafc', fontWeight: 650 }}>
              Slack Workspace
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
              Sign in with Google OAuth in Chrome to connect this project card to your Slack workspace.
            </p>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 18 }}>
              Associated Profile: <strong style={{ color: '#cbd5e1' }}>{targetProfile?.displayName}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                disabled={authBusyApp === 'slack'}
                onClick={() => void handleStartCardAppLogin(project.id, targetProfile?.id, 'slack')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '9px 20px',
                  fontSize: 13,
                  fontWeight: 650,
                  borderRadius: 8,
                  background: 'color-mix(in srgb, var(--accent) 30%, #fff 10%)',
                  border: '1px solid var(--accent)',
                  color: '#fff',
                  cursor: 'pointer',
                  width: '100%',
                  maxWidth: 270
                }}
              >
                <span style={{ fontSize: 15 }}>🌐</span>
                <span>{authBusyApp === 'slack' ? 'Opening Chrome for Google OAuth…' : 'Sign in with Google for Slack'}</span>
              </button>
            </div>
            {authBusyApp === 'slack' && (
              <p style={{ color: '#cbd5e1', fontSize: 12, marginTop: 12 }}>
                Finish Google sign-in in Chrome popup, then return here.
              </p>
            )}
            {authError && authBusyApp === 'slack' && (
              <p style={{ color: '#f87171', fontSize: 12, marginTop: 12 }}>{authError}</p>
            )}
          </div>
        </div>
      )
    } else {
      const source = slackSourceOf(nav) === 'team' ? 'ours' : 'client'
      const listed = channels[connectorOfSelection(sel) === 'team' ? 'team' : 'client']
      const isWholeWorkspace = sel === 's:team' || sel === 's:client' || !isChannelId(sel)

      if (isWholeWorkspace && slackViewMode === 'live' && (cardAuthenticated === true || effectiveSlackTeamId || project.teamId || channels.teamConnected)) {
        body = (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, background: 'var(--bg-page)' }}>
            <PlatformThinBar
              platform="slack"
              workspaceName="Slack Workspace"
              subtitle={project.teamName || effectiveSlackTeamId || (project.teamId && !project.teamId.startsWith('pending-') ? project.teamId : undefined) || targetProfile?.displayName}
              isConnected={Boolean(cardAuthenticated === true || Boolean(effectiveSlackTeamId) || (project.teamId && !project.teamId.startsWith('pending-') && project.teamId !== 'team') || channels.teamConnected)}
              channelCount={slackBrowserSource?.channels?.filter((c) => c.enabled !== false).length ?? 0}
              onOpenControl={() => slackBrowserSource && setControlSource(slackBrowserSource)}
              onReauthenticate={() => void handleStartCardAppLogin(project.id, targetProfile?.id, 'slack')}
            />
            <div style={{ flex: '1 1 0%', minHeight: 0, width: '100%', position: 'relative', overflow: 'hidden' }}>
              <CardLiveSlackEmbed
                projectId={project.id}
                appId="slack"
                profileId={targetProfile?.id}
                hidden={Boolean(channelPickerSourceId)}
                teamId={
                  effectiveSlackTeamId ||
                  (project.teamId &&
                  !project.teamId.startsWith('team-') &&
                  !project.teamId.startsWith('pending-') &&
                  project.teamId !== 'team'
                    ? project.teamId
                    : undefined)
                }
              />
            </div>
          </div>
        )
      } else {
        body = (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
            {isWholeWorkspace && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '4px 14px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
              }}>
                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 2 }}>
                  <button
                    type="button"
                    onClick={() => setSlackViewMode('live')}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 4,
                      background: 'transparent',
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Live Embed
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlackViewMode('messages')}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 4,
                      background: 'var(--accent)',
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Messages
                  </button>
                </div>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
              <SlackChatTab
                key={`${source}:${sel ?? 'all'}`}
                projectId={summary.projectId}
                source={source}
                lockedChannel={
                  sel && isChannelId(sel)
                    ? (() => {
                        const id = channelIdOf(sel)
                        const entry = listed?.entries.find((ch) => ch.id === id)
                        const watched = identity.channels.find((c) => c.channelId === id)
                        return { id, name: entry?.name ?? watched?.channelName ?? id }
                      })()
                    : null
                }
              />
            </div>
          </div>
        )
      }
    }
    bare = true
  } else if (nav.openGroup === 'settings') {
    body = <ProjectSettingsTab project={project} />
    bare = true
  } else if (nav.openGroup === 'viz') {
    body = (
      <CentreVisuals
        visuals={centre.visuals}
        only={sel && isVisualId(sel) ? visualKeyOf(sel) : undefined}
      />
    )
  } else if (nav.openGroup === 'info') {
    if (sel && isDetailId(sel)) {
      body = <DetailBody data={rightSidebar} detailKey={detailKeyOf(sel)} />
    } else if (sel && isGuideId(sel)) {
      body = <GuideDetailBody data={leftSidebar} section={guideSectionOf(sel)} />
    } else {
      // Project info has no body of its own — only rows do. Reaching it from
      // the rail before picking a row must not pretend to be the Dashboard.
      body = (
        <p className="ws-empty">
          Pick a row under Project info — needs reply, blockers, requirements, history — to see what
          this card has learned.
        </p>
      )
    }
  } else {
    // dash — the project overview
    body = <CentreContent centre={centre} />
  }

  const channelPickerElement = channelPickerSourceId
    ? (() => {
        const pickerSource = (project.sources ?? []).find(
          (source) => source.id === channelPickerSourceId
        )
        if (!pickerSource) return null
        return (
          <SourceChannelPicker
            projectId={project.id}
            source={pickerSource}
            open={true}
            onClose={() => {
              setChannelPickerSourceId(null)
            }}
            onSaved={() => {
              void useDashboardStore.getState().loadSnapshot()
              setChannelPickerSourceId(null)
            }}
          />
        )
      })()
    : null

  if (bare) {
    return (
      <>
        <section
          className="ws-content is-bare"
          aria-label={title}
          style={{ flex: '1 1 0%', height: '100%', minHeight: 0, width: '100%' }}
        >
          {body}
        </section>
        {channelPickerElement}
        {controlModalElement}
      </>
    )
  }

  return (
    <>
      <section
        className="ws-content"
        aria-label={title}
        style={{ flex: '1 1 0%', height: '100%', minHeight: 0, width: '100%' }}
      >
        <div className="ws-content-scroll">
          <div className="ws-content-inner">
            <p className="ws-content-eyebrow">{identity.name}</p>
            <h4 className="ws-content-title">{title}</h4>
            <p className="ws-content-desc">{desc}</p>
            <div className="ws-content-body">{body}</div>
          </div>
        </div>
      </section>
      {channelPickerElement}
      {controlModalElement}
    </>
  )
}
