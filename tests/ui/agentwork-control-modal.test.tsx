// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import AgentWorkControlModal from '../../src/renderer/src/components/dashboard/AgentWorkControlModal'

describe('AgentWorkControlModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api = {
      agentwork: {
        checkHealth: vi.fn().mockResolvedValue({
          status: 'ok',
          latencyMs: 42,
          url: 'https://agents.excellencetechnologies.in/api/health'
        }),
        listAgents: vi.fn().mockResolvedValue({
          success: true,
          source: 'local',
          agents: [
            {
              agent_id: 'agent-1',
              agent_name: 'Security Bot',
              role: 'tester',
              online: true,
              purpose: 'Scans for vulnerabilities',
              delivery_mode: 'queue'
            }
          ]
        }),
        dispatchQuery: vi.fn().mockResolvedValue({
          success: true,
          sessionId: 'test-sess',
          response: 'Audit completed cleanly'
        }),
        createAgent: vi.fn().mockResolvedValue({
          success: true,
          agentId: 'agent-new-99'
        })
      },
      profiles: {
        setEmbedVisible: vi.fn(),
        checkCardGoogleSession: vi.fn().mockResolvedValue({
          hasGoogleSession: true,
          count: 5
        })
      }
    }
  })

  afterEach(cleanup)

  it('renders modal with title and all 4 tabs when open', () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    expect(screen.getByTestId('agentwork-control-modal')).toBeDefined()
    expect(screen.getByText('AgentWork Control Suite')).toBeDefined()
    expect(screen.getByText(/Excellence Technologies/i)).toBeDefined()
    expect(screen.getByText(/Card: project-abc/i)).toBeDefined()

    // 4 tabs
    expect(screen.getByTestId('tab-manager')).toBeDefined()
    expect(screen.getByTestId('tab-audits')).toBeDefined()
    expect(screen.getByTestId('tab-logs')).toBeDefined()
    expect(screen.getByTestId('tab-api')).toBeDefined()
  })

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={false}
        onClose={mockOnClose}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders agent cards in Tab 1 (Agent Manager)', async () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('agent-card-agent-1')).toBeDefined()
      expect(screen.getByText('Security Bot')).toBeDefined()
      expect(screen.getByText('Scans for vulnerabilities')).toBeDefined()
    })
  })

  it('switches to Tab 2 and dispatches an audit check', async () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    // Switch to audits tab
    fireEvent.click(screen.getByTestId('tab-audits'))
    expect(screen.getByText('Non-Coding Verification & Audit Suites')).toBeDefined()

    // Select QA suite
    fireEvent.click(screen.getByTestId('suite-item-qa'))
    expect(screen.getAllByText('QA & Test Matrix Verification').length).toBeGreaterThan(0)

    // Dispatch audit
    fireEvent.click(screen.getByTestId('btn-dispatch-audit'))

    await waitFor(() => {
      expect((window as any).api.agentwork.dispatchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-abc',
          role: 'QA Testing Lead'
        })
      )
    })
  })

  it('switches to Tab 3 and displays logs', () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    fireEvent.click(screen.getByTestId('tab-logs'))
    expect(screen.getByText('Execution & Verification Logs')).toBeDefined()
    expect(screen.getByTestId('log-item-log-init')).toBeDefined()
  })

  it('switches to Tab 4 and shows API Explorer & telemetry metrics', async () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    fireEvent.click(screen.getByTestId('tab-api'))
    expect(screen.getByText('AgentWork API Explorer & Telemetry')).toBeDefined()

    await waitFor(() => {
      expect(screen.getByText(/5 Cookies/i)).toBeDefined()
      expect(screen.getByText('/api/agent-directory')).toBeDefined()
      expect(screen.getByText('/api/query')).toBeDefined()
      expect(screen.getByText('/tools/custom/send_message')).toBeDefined()
    })
  })

  it('calls onClose when close button is clicked', () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    fireEvent.click(screen.getByLabelText('Close'))
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('suspends native WebContentsView on mount and restores on unmount', () => {
    const { unmount } = render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    expect((window as any).api.profiles.setEmbedVisible).toHaveBeenCalledWith(false)

    unmount()
    expect((window as any).api.profiles.setEmbedVisible).toHaveBeenCalledWith(true)
  })

  it('renders Slack-style sidebar with Control Options, badges, engine switcher, and card isolation card', async () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        profileId="profile-xyz"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    // Sidebar heading
    expect(screen.getByText('Control Options')).toBeDefined()
    expect(screen.getByText('Active Swarm Engine')).toBeDefined()

    // Radio engine switcher
    const multiAgentRadio = screen.getByLabelText(/Multi-Agent Swarm Bus/i) as HTMLInputElement
    const directBridgeRadio = screen.getByLabelText(/AgentBridge Direct/i) as HTMLInputElement
    expect(multiAgentRadio.checked).toBe(true)
    expect(directBridgeRadio.checked).toBe(false)

    // Toggle radio to AgentBridge Direct
    fireEvent.click(directBridgeRadio)
    expect(directBridgeRadio.checked).toBe(true)
    expect(multiAgentRadio.checked).toBe(false)

    // Card isolation footer in sidebar
    expect(screen.getByText(/persist:card-project-abc-agentwork/i)).toBeDefined()
    expect(screen.getByText(/Profile: profile-xyz/i)).toBeDefined()
  })

  it('triggers audit sweep when clicking the header quick action button', async () => {
    render(
      <AgentWorkControlModal
        projectId="project-abc"
        projectName="Orbit-Dashboards"
        isOpen={true}
        onClose={mockOnClose}
      />
    )

    const runSweepBtn = screen.getByText(/Run Audit Sweep/i)
    fireEvent.click(runSweepBtn)

    await waitFor(() => {
      expect((window as any).api.agentwork.dispatchQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-abc',
          role: 'Security Auditor'
        })
      )
    })
  })
})
