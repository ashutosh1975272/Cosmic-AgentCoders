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
})
