// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAgentWorkIpc, FALLBACK_SWARM_AGENTS } from '../../src/main/ipc/agentwork.ipc'
import { IpcChannels } from '../../src/shared/ipc-contract'

const registeredHandlers = new Map<string, (payload: any) => Promise<any>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: any) => {
      registeredHandlers.set(channel, (payload: any) => handler({}, payload))
    }
  },
  session: {
    defaultSession: {
      fetch: vi.fn()
    },
    fromPartition: vi.fn(() => ({
      fetch: vi.fn()
    }))
  }
}))

describe('agentwork.ipc', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    vi.clearAllMocks()
    registerAgentWorkIpc()
  })

  it('registers all 5 agentwork IPC channels', () => {
    expect(registeredHandlers.has(IpcChannels.AgentWorkCheckHealth)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.AgentWorkListAgents)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.AgentWorkDispatchQuery)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.AgentWorkGetSessionEvents)).toBe(true)
    expect(registeredHandlers.has(IpcChannels.AgentWorkCreateAgent)).toBe(true)
  })

  it('handles AgentWorkCheckHealth successfully when server responds ok', async () => {
    const { session } = await import('electron')
    ;(session.defaultSession.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', version: '2.0.0' })
    })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkCheckHealth)!
    const result = await handler({ baseUrl: 'https://agents.excellencetechnologies.in' })

    expect(result.status).toBe('ok')
    expect(result.url).toBe('https://agents.excellencetechnologies.in/api/health')
    expect(result.data).toEqual({ status: 'healthy', version: '2.0.0' })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('handles AgentWorkCheckHealth gracefully on network failure', async () => {
    const { session } = await import('electron')
    ;(session.defaultSession.fetch as any).mockRejectedValueOnce(new Error('Connection refused'))

    const handler = registeredHandlers.get(IpcChannels.AgentWorkCheckHealth)!
    const result = await handler({ baseUrl: 'https://invalid-url.local' })

    expect(result.status).toBe('error')
    expect(result.error).toContain('Connection refused')
  })

  it('handles AgentWorkListAgents and returns live agents when available', async () => {
    const { session } = await import('electron')
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        agents: [
          {
            agent_id: 'live-1',
            agent_name: 'Security Bot',
            label: '🛡️ Sec',
            online: true,
            delivery_mode: 'inbox'
          }
        ]
      })
    })
    ;(session.fromPartition as any).mockReturnValue({ fetch: mockFetch })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkListAgents)!
    const result = await handler({ projectId: 'test-proj' })

    expect(result.success).toBe(true)
    expect(result.source).toBe('live')
    expect(result.agents.length).toBe(1)
    expect(result.agents[0].agent_name).toBe('Security Bot')
  })

  it('falls back to local swarm agents if live directory fails', async () => {
    const { session } = await import('electron')
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Auth required'))
    ;(session.fromPartition as any).mockReturnValue({ fetch: mockFetch })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkListAgents)!
    const result = await handler({ projectId: 'test-proj' })

    expect(result.success).toBe(true)
    expect(result.source).toBe('local')
    expect(result.agents).toEqual(FALLBACK_SWARM_AGENTS)
    expect(result.agents.length).toBe(6)
  })

  it('handles AgentWorkDispatchQuery and dispatches query', async () => {
    const { session } = await import('electron')
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ session_id: 'sess-123', message: 'Turn queued' })
    })
    ;(session.fromPartition as any).mockReturnValue({ fetch: mockFetch })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkDispatchQuery)!
    const result = await handler({
      projectId: 'test-proj',
      query: 'Run security scan',
      role: 'security'
    })

    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('sess-123')
    expect(result.response).toBe('Turn queued')
  })

  it('handles AgentWorkGetSessionEvents', async () => {
    const { session } = await import('electron')
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        events: [{ type: 'step', text: 'Scanned 14 files' }]
      })
    })
    ;(session.fromPartition as any).mockReturnValue({ fetch: mockFetch })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkGetSessionEvents)!
    const result = await handler({ projectId: 'test-proj', sessionId: 'sess-123' })

    expect(result.success).toBe(true)
    expect(result.events).toHaveLength(1)
  })

  it('handles AgentWorkCreateAgent', async () => {
    const { session } = await import('electron')
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ project_id: 'proj-new-agent' })
    })
    ;(session.fromPartition as any).mockReturnValue({ fetch: mockFetch })

    const handler = registeredHandlers.get(IpcChannels.AgentWorkCreateAgent)!
    const result = await handler({
      projectId: 'test-proj',
      name: 'Custom QA Agent',
      role: 'tester'
    })

    expect(result.success).toBe(true)
    expect(result.agentId).toBe('proj-new-agent')
  })
})
