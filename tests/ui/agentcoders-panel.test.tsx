// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AgentCodersPanel from '../../src/renderer/src/components/dashboard/AgentCodersPanel'
import { useAgentCodersStore } from '../../src/renderer/src/hooks/useAgentCodersStore'

describe('AgentCodersPanel UI tests', () => {
  beforeEach(() => {
    useAgentCodersStore.getState().resetSwarm()
  })

  afterEach(cleanup)

  it('renders inner sidebar with all 6 swarm agents and project title', () => {
    render(<AgentCodersPanel projectId="p1" projectName="Acme Swarm" />)

    expect(screen.getByText('🤖 AgentCoders Swarm')).toBeDefined()
    expect(screen.getByText(/Acme Swarm/)).toBeDefined()
    expect(screen.getAllByText('Head Agent').length).toBeGreaterThan(0)
    expect(screen.getByText('Architect')).toBeDefined()
    expect(screen.getByText('Coder')).toBeDefined()
    expect(screen.getByText('Tester')).toBeDefined()
    expect(screen.getByText('Reviewer')).toBeDefined()
    expect(screen.getByText('AgentWork Executor')).toBeDefined()

    // Platform switcher
    expect(screen.getByText('PLATFORM:')).toBeDefined()
    expect(screen.getByText('Antigravity')).toBeDefined()
    expect(screen.getByText('OpenCode')).toBeDefined()
  })

  it('switches agent tab when clicked in inner sidebar', () => {
    render(<AgentCodersPanel projectId="p1" projectName="Acme Swarm" />)

    // Initially on Head Agent
    expect(screen.getByText('Supreme Swarm Orchestrator & Planner')).toBeDefined()

    // Click Architect
    fireEvent.click(screen.getByText('Architect'))
    expect(screen.getByText('Deep Codebase Design & Domain Modeling')).toBeDefined()

    // Click Coder
    fireEvent.click(screen.getByText('Coder'))
    expect(screen.getByText('Autonomous TDD Implementation Engine')).toBeDefined()
  })

  it('submits a goal to Head Agent and displays A2A Task Partitioning Board', () => {
    render(<AgentCodersPanel projectId="p1" projectName="Acme Swarm" />)

    const textarea = screen.getByPlaceholderText(
      /Submit high-level coding goal to @HeadAgent/
    ) as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'Build high-performance message cache' } })
    fireEvent.click(screen.getByText('Dispatch Swarm'))

    // The A2A Task Board appears with partitioned subtasks
    expect(screen.getByText(/A2A TASK PARTITIONING BOARD/)).toBeDefined()
    expect(screen.getByText('System Design & Deep Module Boundaries')).toBeDefined()
    expect(screen.getByText('TDD Test Suites & Assertion Matrix')).toBeDefined()
    expect(screen.getByText('Feature Implementation & Synthesis')).toBeDefined()
    expect(screen.getByText('Two-Axis Code Review (Spec + Standards)')).toBeDefined()
  })

  it('minimizes sidebar to collapsed icon rail and restores it on expand click', () => {
    localStorage.clear()
    render(<AgentCodersPanel projectId="p1" projectName="Acme Swarm" />)

    const sidebar = screen.getByTestId('agentcoders-inner-sidebar')
    expect(sidebar.style.width).toBe('280px')

    // Find collapse button and click it
    const collapseBtn = screen.getByRole('button', { name: /Collapse sidebar/i })
    fireEvent.click(collapseBtn)

    // Now collapsed: width is 64px, expand button is rendered
    expect(sidebar.style.width).toBe('64px')
    const expandBtn = screen.getByRole('button', { name: /Expand sidebar/i })
    expect(expandBtn).toBeDefined()

    // Agent icon buttons are rendered in collapsed rail
    const architectIconBtn = screen.getByRole('button', { name: 'Architect' })
    expect(architectIconBtn).toBeDefined()

    // Clicking an agent in collapsed rail switches active agent
    fireEvent.click(architectIconBtn)
    expect(screen.getByText('Deep Codebase Design & Domain Modeling')).toBeDefined()

    // Click expand button to restore full sidebar
    fireEvent.click(expandBtn)
    expect(sidebar.style.width).toBe('280px')
    expect(screen.getByText('🤖 AgentCoders Swarm')).toBeDefined()
  })

  it('renders resizer separator and resets width to 280px on double click', () => {
    localStorage.clear()
    render(<AgentCodersPanel projectId="p1" projectName="Acme Swarm" />)

    const resizer = screen.getByRole('separator', { name: /Resize inner sidebar/i })
    expect(resizer).toBeDefined()

    // Double click resizer resets to 280px
    fireEvent.doubleClick(resizer)
    const sidebar = screen.getByTestId('agentcoders-inner-sidebar')
    expect(sidebar.style.width).toBe('280px')
  })
})
