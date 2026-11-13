// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { useAgentCodersStore, SWARM_AGENTS } from '../../src/renderer/src/hooks/useAgentCodersStore'

describe('useAgentCodersStore', () => {
  beforeEach(() => {
    useAgentCodersStore.getState().resetSwarm()
  })

  it('initializes with Head Agent as active and 6 defined swarm agents', () => {
    const state = useAgentCodersStore.getState()
    expect(state.activeAgentId).toBe('head')
    expect(SWARM_AGENTS.length).toBe(6)

    const handles = SWARM_AGENTS.map((a) => a.handle)
    expect(handles).toContain('@HeadAgent')
    expect(handles).toContain('@Architect')
    expect(handles).toContain('@Coder')
    expect(handles).toContain('@Reviewer')
    expect(handles).toContain('@Tester')
    expect(handles).toContain('@AgentWorkExecutor')

    // Initial messages exist for each agent
    expect(state.agentMessages.head.length).toBeGreaterThan(0)
    expect(state.agentMessages.architect.length).toBeGreaterThan(0)
    expect(state.agentMessages.coder.length).toBeGreaterThan(0)
    expect(state.tasks.length).toBe(0)
    expect(state.swarmProgress).toBe(0)
  })

  it('switches active agent', () => {
    useAgentCodersStore.getState().setActiveAgent('architect')
    expect(useAgentCodersStore.getState().activeAgentId).toBe('architect')

    useAgentCodersStore.getState().setActiveAgent('coder')
    expect(useAgentCodersStore.getState().activeAgentId).toBe('coder')
  })

  it('dispatches task from Head Agent and creates A2A partitioned subtasks', () => {
    const goal = 'Implement auth token refresh with TDD and deep module boundary'
    useAgentCodersStore.getState().dispatchTaskFromHead(goal)

    const state = useAgentCodersStore.getState()
    expect(state.swarmGoal).toBe(goal)
    expect(state.isOrchestrating).toBe(true)
    expect(state.tasks.length).toBe(4)

    // Check task allocation across specialized subagents
    const assignedAgents = state.tasks.map((t) => t.assignedTo)
    expect(assignedAgents).toContain('architect')
    expect(assignedAgents).toContain('tester')
    expect(assignedAgents).toContain('coder')
    expect(assignedAgents).toContain('reviewer')

    // Check initial progress
    expect(state.swarmProgress).toBeGreaterThan(0)

    // User message and head reply posted in head agent chat
    expect(state.agentMessages.head.some((m) => m.text === goal)).toBe(true)
    expect(state.agentMessages.architect.some((m) => m.assignedFromHead)).toBe(true)
  })

  it('updates task status and recalculates aggregated swarm progress', () => {
    useAgentCodersStore.getState().dispatchTaskFromHead('Build feature')
    const firstTask = useAgentCodersStore.getState().tasks[0]

    useAgentCodersStore.getState().updateTaskStatus(firstTask.id, 'completed', 100, 'Done')

    const updatedTask = useAgentCodersStore.getState().tasks.find((t) => t.id === firstTask.id)
    expect(updatedTask?.status).toBe('completed')
    expect(updatedTask?.progress).toBe(100)
    expect(updatedTask?.summary).toBe('Done')
  })

  it('resets swarm state cleanly', () => {
    useAgentCodersStore.getState().dispatchTaskFromHead('Some coding task')
    expect(useAgentCodersStore.getState().tasks.length).toBeGreaterThan(0)

    useAgentCodersStore.getState().resetSwarm()
    const state = useAgentCodersStore.getState()
    expect(state.tasks.length).toBe(0)
    expect(state.swarmGoal).toBeNull()
    expect(state.swarmProgress).toBe(0)
    expect(state.isOrchestrating).toBe(false)
  })

  it('persists messages to localStorage and restores history via loadProjectHistory', () => {
    const projId = 'proj-persist-test'
    useAgentCodersStore.getState().loadProjectHistory(projId)

    // Post a custom question to coder
    useAgentCodersStore.getState().postMessage('coder', {
      senderId: 'user',
      senderName: 'You',
      text: 'How do we implement red-green tests?'
    })

    // Reset store in-memory state
    useAgentCodersStore.getState().resetSwarm()

    // Load history for projId
    useAgentCodersStore.getState().loadProjectHistory(projId)

    const state = useAgentCodersStore.getState()
    expect(
      state.agentMessages.coder.some((m) => m.text === 'How do we implement red-green tests?')
    ).toBe(true)
  })

  it('isolates chat history across different project IDs', () => {
    const projA = 'proj-A'
    const projB = 'proj-B'

    useAgentCodersStore.getState().loadProjectHistory(projA)
    useAgentCodersStore.getState().postMessage('architect', {
      senderId: 'user',
      senderName: 'You',
      text: 'Question exclusive to Project A'
    })

    useAgentCodersStore.getState().loadProjectHistory(projB)
    expect(
      useAgentCodersStore
        .getState()
        .agentMessages.architect.some((m) => m.text === 'Question exclusive to Project A')
    ).toBe(false)

    // Re-loading projA restores the message
    useAgentCodersStore.getState().loadProjectHistory(projA)
    expect(
      useAgentCodersStore
        .getState()
        .agentMessages.architect.some((m) => m.text === 'Question exclusive to Project A')
    ).toBe(true)
  })
})
