import { useDashboardStore } from '../../hooks/useDashboard'

export default function DashboardRail(): React.JSX.Element {
  const openDashboard = useDashboardStore((s) => s.openDashboard)
  const dashboardOpen = useDashboardStore((s) => s.dashboardOpen)
  const expanded = useDashboardStore((s) => s.dashRailExpanded)
  const setExpanded = useDashboardStore((s) => s.setDashRailExpanded)

  const handleDashboardClick = (): void => {
    openDashboard('slack')
    setExpanded(true)
    void window.api?.profiles?.setEmbedVisible?.(false)
    void window.api?.profiles?.clearCardSlackEmbed?.()
  }

  return (
    <div className="dash-entry" data-testid="dashboard-rail">
      <button
        type="button"
        className={`recent-item dash-entry-row${dashboardOpen ? ' is-active' : ''}`}
        onClick={handleDashboardClick}
        aria-expanded={expanded}
        data-testid="dashboard-toggle"
        title="Dashboard"
      >
        <span className="recent-app-chip dash-entry-glyph" aria-hidden>
          ▦
        </span>
        <span className="ws-copy">
          <span className="ws-title">Dashboard</span>
        </span>
        <span
          className={`dash-entry-chevron${expanded ? ' open' : ''}`}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
        >
          ▸
        </span>
      </button>

      {expanded ? (
        <div className="dash-entry-apps" role="menu" aria-label="Dashboard apps">
          <button
            type="button"
            role="menuitem"
            className={`recent-item dash-entry-app${dashboardOpen ? ' is-active' : ''}`}
            onClick={handleDashboardClick}
            data-testid="dashboard-app-slack"
          >
            <span className="recent-app-chip dash-entry-glyph" aria-hidden>
              ▤
            </span>
            <span className="ws-copy">
              <span className="ws-title">Project</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
