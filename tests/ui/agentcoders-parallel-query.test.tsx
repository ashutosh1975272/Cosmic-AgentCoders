// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentChatPanel from '../../src/renderer/src/components/dashboard/AgentChatPanel'
import AgentCodersPanel from '../../src/renderer/src/components/dashboard/AgentCodersPanel'
import { useAgentCodersStore } from '../../src/renderer/src/hooks/useAgentCodersStore'
import type {
  DashboardProjectChatHistoryResult,
  DashboardProjectChatMessage,
  DashboardProjectChatStatus
} from '../../src/shared/dashboard-contract'

let snapshotListeners: Array<(snapshot: any) => void> = []
let persistedHistory: DashboardProjectChatMessage[] = []

function installApi(options: { history?: DashboardProjectChatMessage[] } = {}): {
  appendMock: ReturnType<typeof vi.fn>
  fireSnapshot: () => void
} {
  snapshotListeners = []
  persistedHistory = options.history ? [...options.history] : []

  const history = vi.fn(async (): Promise<DashboardProjectChatHistoryResult> => ({
    messages: [...persistedHistory]
  }))
  const statusMock = vi.fn(async (): Promise<DashboardProjectChatStatus> => ({
    hasKey: true,
    model: 'meta/llama-3.3-70b',
    modelSource: 'project',
    keySource: 'project'
  }))
  const projectChat = vi.fn(async () => ({ ok: true as const, runId: 'run-1' }))
  const cancelProjectChat = vi.fn(async () => ({ ok: true }))
  const clearProjectChat = vi.fn(async () => {
    persistedHistory = []
    return { ok: true }
  })
  const updateSource = vi.fn(async () => ({ ok: true }))
  const sendMessage = vi.fn(async () => ({
    ok: true,
    message: { channelId: 'C1', ts: '123', text: 'hi', atIso: new Date().toISOString() }
  }))
  const appendProjectChatMessage = vi.fn(
    async (payload: { message: DashboardProjectChatMessage }) => {
      persistedHistory.push(payload.message)
      return { ok: true }
    }
  )

  const dashboard = {
    getProjectChatHistory: history,
    appendProjectChatMessage,
    getProjectChatStatus: statusMock,
    projectChat,
    cancelProjectChat,
    clearProjectChat,
    updateSource,
    sendMessage,
    onProjectChatChunk: () => () => {},
    onProjectChatDone: () => () => {},
    onProjectChatError: () => () => {},
    onConfigChanged: () => () => {},
    onSnapshotChanged: (cb: (snapshot: any) => void) => {
      snapshotListeners.push(cb)
      return () => {
        snapshotListeners = snapshotListeners.filter((l) => l !== cb)
      }
    }
  }

  window.api = { dashboard } as unknown as Window['api']

  return {
    appendMock: appendProjectChatMessage,
    fireSnapshot: () => {
      for (const listener of snapshotListeners) {
        listener({ projects: [] } as any)
      }
    }
  }
}

describe('AgentCoders Parallel Query Bridge & Threading', () => {
  beforeEach(() => {
    installApi()
    useAgentCodersStore.getState().resetSwarm()
  })

  afterEach(cleanup)

  it('routes roster question from Project Chat to Head Agent, shows live working animation, and renders dynamic roster of all 6 agents with telemetry', async () => {
    const onSelectAgentCoders = vi.fn()
    render(
      <AgentChatPanel
        projectId="p-bridge"
        projectName="Orbit Engine"
        mode="project"
        onSelectAgentCoders={onSelectAgentCoders}
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    // Submit user prompt mentioning Head Agent asking for roster
    fireEvent.change(textarea, {
      target: {
        value:
          '$AgentWork @HeadAgent : here try to tell me properly in thier what are the agents you have currently tell me all thse agents name properly in thier'
      }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // 1. Live working animation card is rendered immediately
    expect(screen.getByTestId('swarm-working-card')).toBeDefined()
    expect(screen.getByTestId('swarm-timer-badge')).toBeDefined()
    expect(screen.getByText(/@HeadAgent is analyzing inquiry/i)).toBeDefined()

    // 2. Wait for completion and verify dynamic roster answer detailing all 6 agents
    await waitFor(
      () => {
        expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
      },
      { timeout: 3000 }
    )

    // All 6 agents must be in the rendered response
    expect(screen.getAllByText(/@HeadAgent/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/@Architect/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/@Coder/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/@Tester/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/@Reviewer/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/@AgentWorkExecutor/).length).toBeGreaterThanOrEqual(1)

    // 3. Telemetry badges render: execution time, tokens, thread badge
    expect(screen.getByTestId('swarm-execution-time-badge')).toBeDefined()
    expect(screen.getByTestId('swarm-tokens-badge')).toBeDefined()
    expect(screen.getByTestId('swarm-thread-badge')).toBeDefined()

    // 4. Workspace Jump Button is available and clicking navigates
    const jumpBtn = screen.getByTestId('swarm-jump-workspace-btn')
    expect(jumpBtn).toBeDefined()
    fireEvent.click(jumpBtn)
    expect(onSelectAgentCoders).toHaveBeenCalled()
  })

  it('handles multiple parallel non-blocking queries simultaneously', async () => {
    render(
      <AgentChatPanel
        projectId="p-parallel"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    // Dispatch Query 1: To @Architect
    fireEvent.change(textarea, {
      target: { value: '@Architect : design auth module seams and domain model' }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Input is immediately freed (not disabled by streaming lock)
    expect(textarea.value).toBe('')

    // Dispatch Query 2: To @Tester
    fireEvent.change(textarea, {
      target: { value: '@Tester : generate red-stage vitest assertions' }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Both queries are running in parallel
    const workingCards = screen.getAllByTestId('swarm-working-card')
    expect(workingCards.length).toBe(2)

    // Wait for both queries to resolve concurrently
    await waitFor(
      () => {
        expect(screen.getByText(/Architect Specialist Assessment/i)).toBeDefined()
        expect(screen.getByText(/Tester Verification Suite/i)).toBeDefined()
      },
      { timeout: 4000 }
    )

    // Both completed queries display execution telemetry
    const timeBadges = screen.getAllByTestId('swarm-execution-time-badge')
    expect(timeBadges.length).toBe(2)

    const tokenBadges = screen.getAllByTestId('swarm-tokens-badge')
    expect(tokenBadges.length).toBe(2)
  })

  it('synchronizes queries and replies into AgentCodersPanel with provenance, telemetry, and threaded follow-up grouping', async () => {
    // 1. Dispatch initial question via store
    const query1 = await useAgentCodersStore.getState().dispatchSwarmQuery({
      prompt: 'What are the architectural seams in the app?',
      targetAgentId: 'head',
      source: 'project_chat'
    })

    // 2. Dispatch threaded follow-up query linked to query1
    await useAgentCodersStore.getState().dispatchSwarmQuery({
      prompt: 'And also how do we migrate tests using Shoehorn?',
      targetAgentId: 'head',
      parentQueryId: query1.id,
      source: 'project_chat'
    })

    // 3. Render AgentCodersPanel (Head Agent workspace view)
    render(<AgentCodersPanel projectId="p-prov" projectName="Orbit Engine" />)

    // Verify incoming questions from master chat carry [Via Project Chat] provenance tag
    const viaProjectBadges = screen.getAllByTestId('provenance-project-chat')
    expect(viaProjectBadges.length).toBeGreaterThanOrEqual(2)
    expect(viaProjectBadges[0].textContent).toContain('[Via Project Chat]')

    // Verify outgoing replies carry [Dispatched to Project Chat] provenance tag
    const dispatchedBadges = screen.getAllByTestId('provenance-dispatched')
    expect(dispatchedBadges.length).toBeGreaterThanOrEqual(2)
    expect(dispatchedBadges[0].textContent).toContain('[Dispatched to Project Chat]')

    // Verify telemetry is rendered on messages
    const messageTelemetryBadges = screen.getAllByTestId('message-telemetry')
    expect(messageTelemetryBadges.length).toBeGreaterThan(0)
    expect(messageTelemetryBadges[0].textContent).toMatch(/⏱️.*s · 🪙 ~.*tokens/)

    // Verify threaded follow-up grouping indicator is rendered on follow-up ONLY
    const threadIndicators = screen.getAllByTestId('threaded-reply-indicator')
    expect(threadIndicators.length).toBe(1)
    expect(threadIndicators[0].textContent).toContain('Threaded follow-up')

    // Verify sender name correctly identifies Project Master Agent
    expect(screen.getAllByText('Project Master Agent (Chat)').length).toBeGreaterThanOrEqual(1)

    // Verify thread ID tag is rendered
    const threadTags = screen.getAllByTestId('message-thread-tag')
    expect(threadTags.length).toBeGreaterThan(0)
  })

  it('populates both Head Agent and subagent histories when Head Agent delegates a task', async () => {
    // Dispatch query to Head Agent requiring Architectural analysis
    await useAgentCodersStore.getState().dispatchSwarmQuery({
      prompt: 'Design modular domain model and seam boundaries',
      targetAgentId: 'head',
      source: 'project_chat'
    })

    const state = useAgentCodersStore.getState()
    const headMessages = state.agentMessages.head
    const architectMessages = state.agentMessages.architect

    // In Head Agent history:
    // 1. Initial inquiry from Project Master Agent
    const headUserMsg = headMessages.find((m) => m.senderId === 'user')
    expect(headUserMsg).toBeDefined()
    expect(headUserMsg?.senderName).toBe('Project Master Agent (Chat)')
    expect(headUserMsg?.provenance).toBe('project_chat')

    // 2. Synthesized delegation answer in Head Agent history
    const headConsultationMsg = headMessages.find((m) => m.statusBadge === 'DELEGATED TO ARCHITECT')
    expect(headConsultationMsg).toBeDefined()
    expect(headConsultationMsg?.text).toContain('@Architect Consultation')
    expect(headConsultationMsg?.telemetry).toBeDefined()

    // In Architect subagent history:
    // 1. Delegated question from Head Agent is recorded!
    const architectTaskMsg = architectMessages.find((m) => m.statusBadge === 'DELEGATED FROM HEAD')
    expect(architectTaskMsg).toBeDefined()
    expect(architectTaskMsg?.senderName).toContain('Head Agent (via Project Chat)')
    expect(architectTaskMsg?.assignedFromHead).toBe(true)
    expect(architectTaskMsg?.text).toContain('Design modular domain model')

    // 2. Specialist reply in Architect history
    const architectReplyMsg = architectMessages.find((m) => m.statusBadge === 'SPECIALIST REPLY')
    expect(architectReplyMsg).toBeDefined()
    expect(architectReplyMsg?.senderName).toBe('Architect')
    expect(architectReplyMsg?.telemetry).toBeDefined()
  })

  it('routes @HeadAgent mention with sub-agent references to Head Agent orchestrator', async () => {
    render(
      <AgentChatPanel
        projectId="p-priority"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    // User mentions HeadAgent, but text also mentions @Architect
    fireEvent.change(textarea, {
      target: {
        value: '$AgentWork @HeadAgent : please consult with @Architect about data structures'
      }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Must show working card with Head Agent orchestrating
    expect(screen.getByTestId('swarm-working-card')).toBeDefined()

    // Wait for resolution and verify Architect consultation occurred
    await waitFor(
      () => {
        expect(screen.getByText(/Architect Specialist Assessment/i)).toBeDefined()
      },
      { timeout: 3000 }
    )
  })

  it('renders completed message correctly even if query state is pruned', async () => {
    render(
      <AgentChatPanel
        projectId="p-pruned"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    fireEvent.change(textarea, {
      target: { value: '@HeadAgent : who are you and list agents' }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Wait for completed answer
    await waitFor(
      () => {
        expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
      },
      { timeout: 3000 }
    )

    // Clear active queries from store (simulating cache pruning or store reset)
    useAgentCodersStore.getState().resetSwarm()

    // Message must STILL render the markdown answer and NOT revert to an infinite working spinner!
    expect(screen.queryByTestId('swarm-working-card')).toBeNull()
    expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
  })

  it('preserves Swarm Q&A in chat feed when background reload or onSnapshotChanged occurs (never disappears)', async () => {
    const api = installApi()
    render(
      <AgentChatPanel
        projectId="p-persist"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    // 1. Send query to Head Agent
    fireEvent.change(textarea, {
      target: {
        value: '$AgentWork @HeadAgent : tell me what are the agents you have currently'
      }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Working card shows initially
    expect(screen.getByTestId('swarm-working-card')).toBeDefined()

    // 2. Wait for completed response
    await waitFor(
      () => {
        expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
      },
      { timeout: 3000 }
    )

    // Verify disk persistence via appendProjectChatMessage occurred for both user and assistant
    expect(api.appendMock).toHaveBeenCalledTimes(2)
    const userCall = api.appendMock.mock.calls[0][0]
    expect(userCall.message.role).toBe('user')
    expect(userCall.message.swarmQueryId).toBeDefined()
    const assistantCall = api.appendMock.mock.calls[1][0]
    expect(assistantCall.message.role).toBe('assistant')
    expect(assistantCall.message.swarmQueryId).toBeDefined()

    // 3. Trigger snapshot change (which calls loadChannelAndChatHistory, just like 5s background poll)
    api.fireSnapshot()

    // 4. Wait and assert the Swarm answer is STILL present in the chat feed (did NOT disappear)
    await waitFor(() => {
      expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
      expect(screen.getByTestId('swarm-execution-time-badge')).toBeDefined()
      expect(screen.getByTestId('swarm-tokens-badge')).toBeDefined()
    })

    // User question must also still be visible
    expect(screen.getByText(/tell me what are the agents you have currently/i)).toBeDefined()
  })

  it('reconciles in-flight active swarm queries so the live working card does not disappear during polling', async () => {
    const api = installApi()
    render(
      <AgentChatPanel
        projectId="p-inflight"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    const textarea = (await screen.findByPlaceholderText(
      /Ask about this project/i
    )) as HTMLTextAreaElement

    fireEvent.change(textarea, {
      target: { value: '@HeadAgent : who are you' }
    })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    // Live working card is visible immediately
    expect(screen.getByTestId('swarm-working-card')).toBeDefined()

    // Trigger snapshot sync immediately while still analyzing
    api.fireSnapshot()

    // Live working card MUST NOT disappear!
    expect(screen.getByTestId('swarm-working-card')).toBeDefined()

    // Wait for resolution
    await waitFor(
      () => {
        expect(screen.getByText(/Complete Roster & Agent Hierarchy/i)).toBeDefined()
      },
      { timeout: 3000 }
    )
  })

  it('hydrates previous Swarm queries from store and disk when mounting panel', async () => {
    installApi()
    // Pre-populate a completed project_chat query in store
    await useAgentCodersStore.getState().dispatchSwarmQuery({
      prompt: 'Summarize system architecture seams',
      targetAgentId: 'head',
      source: 'project_chat',
      projectId: 'p-hydrate'
    })

    render(
      <AgentChatPanel
        projectId="p-hydrate"
        projectName="Orbit Engine"
        mode="project"
      />
    )

    // Query and answer should be hydrated into the chat feed automatically
    await waitFor(() => {
      expect(screen.getAllByText(/Summarize system architecture seams/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/Specialist Assessment/i)).toBeDefined()
    })
  })
})
