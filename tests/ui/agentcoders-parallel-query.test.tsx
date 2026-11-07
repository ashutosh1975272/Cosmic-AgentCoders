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

function installApi(options: { history?: DashboardProjectChatMessage[] } = {}): void {
  const history = vi.fn(async (): Promise<DashboardProjectChatHistoryResult> => ({
    messages: options.history ?? []
  }))
  const statusMock = vi.fn(async (): Promise<DashboardProjectChatStatus> => ({
    hasKey: true,
    model: 'meta/llama-3.3-70b',
    modelSource: 'project',
    keySource: 'project'
  }))
  const projectChat = vi.fn(async () => ({ ok: true as const, runId: 'run-1' }))
  const cancelProjectChat = vi.fn(async () => ({ ok: true }))
  const clearProjectChat = vi.fn(async () => ({ ok: true }))
  const updateSource = vi.fn(async () => ({ ok: true }))
  const sendMessage = vi.fn(async () => ({
    ok: true,
    message: { channelId: 'C1', ts: '123', text: 'hi', atIso: new Date().toISOString() }
  }))

  const dashboard = {
    getProjectChatHistory: history,
    getProjectChatStatus: statusMock,
    projectChat,
    cancelProjectChat,
    clearProjectChat,
    updateSource,
    sendMessage,
    onProjectChatChunk: () => () => {},
    onProjectChatDone: () => () => {},
    onProjectChatError: () => () => {},
    onConfigChanged: () => () => {}
  }

  window.api = { dashboard } as unknown as Window['api']
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

    // Verify threaded follow-up grouping indicator is rendered
    const threadIndicators = screen.getAllByTestId('threaded-reply-indicator')
    expect(threadIndicators.length).toBeGreaterThan(0)
    expect(threadIndicators[0].textContent).toContain('Threaded follow-up')

    // Verify thread ID tag is rendered
    const threadTags = screen.getAllByTestId('message-thread-tag')
    expect(threadTags.length).toBeGreaterThan(0)
  })
})
