// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSettingsTab from '../../src/renderer/src/components/dashboard/ProjectSettingsTab'
import { richSnapshot } from '../../src/renderer/src/demo/fixtures'
import { useDashboardStore } from '../../src/renderer/src/hooks/useDashboard'

beforeEach(() => {
  window.api = {
    app: {
      getSettings: vi.fn().mockResolvedValue({
        showDashboardSlack: true,
        showDashboardTeams: true,
        showDashboardWhatsApp: true,
        showDashboardAgentControl: false,
        showDashboardActivityFeed: true,
        showDashboardAttention: true,
        showDashboardDecisionVault: true
      }),
      onSettingsChanged: vi.fn().mockReturnValue(() => {})
    },
    dashboard: {
      upsertProject: vi.fn().mockImplementation(async (proj) => proj),
      getChatTokenStatus: vi.fn().mockResolvedValue({
        connected: true,
        source: 'manual',
        teamName: 'AgentWork',
        maskedToken: '••••3f22',
        scopes: ['channels:history', 'chat:write'],
        canSend: true
      }),
      getAiSettings: vi.fn().mockResolvedValue({
        global: {
          provider: 'nvidia-nim',
          model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          embeddingModel: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
          apiKeyMask: '••••LZt_',
          hasKey: true,
          status: 'verified'
        },
        project: null,
        effective: {
          provider: 'nvidia-nim',
          model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          chatModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
          embeddingModel: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
          apiKey: null,
          chatModelSource: 'global',
          embeddingModelSource: 'global',
          keySource: 'global',
          apiKeyMask: '••••LZt_'
        }
      }),
      listAiModels: vi.fn().mockResolvedValue({
        models: ['nvidia/nemotron-3.5-super-vl-120b-a12b'],
        embeddingModels: [],
        source: 'global'
      })
    }
  } as any

  useDashboardStore.setState({
    projects: [richSnapshot.project],
    upsertProject: vi.fn().mockImplementation(async (p) => {
      useDashboardStore.setState({ projects: [p] } as any)
      return p
    })
  } as any)
})

afterEach(() => {
  cleanup()
})

describe('ProjectSettingsTab — Dashboard Rules Tab', () => {
  it('renders the Dashboard tab in navigation and displays 3-state inheritance controls', async () => {
    render(<ProjectSettingsTab project={richSnapshot.project} />)

    const dashTab = screen.getByRole('tab', { name: /Dashboard/i })
    expect(dashTab).toBeDefined()

    fireEvent.click(dashTab)

    await waitFor(() => {
      expect(screen.getByText(/Project Dashboard Rules & Overrides/i)).toBeDefined()
    })

    expect(screen.getByText(/Multiplatform Activity Stream Ingestion/i)).toBeDefined()
    expect(screen.getByText(/Dispatchers & Cards Visibility/i)).toBeDefined()

    // Find the WhatsApp select element
    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBeGreaterThanOrEqual(7)
  })

  it('updates dashboardRules when a platform rule is changed to off', async () => {
    const upsertSpy = vi.fn().mockImplementation(async (p) => p)
    useDashboardStore.setState({
      projects: [richSnapshot.project],
      upsertProject: upsertSpy
    } as any)

    render(<ProjectSettingsTab project={richSnapshot.project} />)

    const dashTab = screen.getByRole('tab', { name: /Dashboard/i })
    fireEvent.click(dashTab)

    await waitFor(() => {
      expect(screen.getByText(/Project Dashboard Rules & Overrides/i)).toBeDefined()
    })

    // Third select corresponds to WhatsApp
    const selects = screen.getAllByRole('combobox')
    const waSelect = selects[2]

    fireEvent.change(waSelect, { target: { value: 'off' } })

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalled()
      const callArg = upsertSpy.mock.calls[0][0]
      expect(callArg.dashboardRules?.platforms?.whatsapp).toBe('off')
    })
  })

  it('resets rules to global when Reset All to Global is clicked', async () => {
    const projectWithRules = {
      ...richSnapshot.project,
      dashboardRules: {
        platforms: {
          whatsapp: 'off' as const
        }
      }
    }

    const upsertSpy = vi.fn().mockImplementation(async (p) => p)
    useDashboardStore.setState({
      projects: [projectWithRules],
      upsertProject: upsertSpy
    } as any)

    render(<ProjectSettingsTab project={projectWithRules} />)

    const dashTab = screen.getByRole('tab', { name: /Dashboard/i })
    fireEvent.click(dashTab)

    await waitFor(() => {
      expect(screen.getByText(/Reset All to Global/i)).toBeDefined()
    })

    fireEvent.click(screen.getByText(/Reset All to Global/i))

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalled()
      const callArg = upsertSpy.mock.calls[0][0]
      expect(callArg.dashboardRules).toBeUndefined()
    })
  })
})
