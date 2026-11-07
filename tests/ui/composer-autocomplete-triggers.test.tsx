// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ComposerAutocompletePopover from '../../src/renderer/src/components/dashboard/ComposerAutocompletePopover'

describe('ComposerAutocompletePopover Multi-Trigger Tests', () => {
  afterEach(cleanup)

  it('renders all platforms when trigger is $ in project scope', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="$"
        query=""
        contextScope="project"
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('listbox')).toBeDefined()
    expect(screen.getByText('$AgentWork')).toBeDefined()
    expect(screen.getByText('$Antigravity')).toBeDefined()
    expect(screen.getByText('$OpenCode')).toBeDefined()

    // Click $AgentWork
    fireEvent.click(screen.getByText('$AgentWork'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '$AgentWork '
      })
    )
  })

  it('renders $AgentWork as active and $Antigravity/$OpenCode as preview when trigger is $ in agentcoders scope', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="$"
        query=""
        contextScope="agentcoders"
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByText('$AgentWork')).toBeDefined()
    expect(screen.getByText('ACTIVE PLATFORM')).toBeDefined()
    expect(screen.getByText('$Antigravity')).toBeDefined()
    expect(screen.getByText('$OpenCode')).toBeDefined()
  })

  it('renders specialized coding agents when trigger is @', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="@"
        query=""
        contextScope="agentcoders"
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByText('@HeadAgent')).toBeDefined()
    expect(screen.getByText('@Architect')).toBeDefined()
    expect(screen.getByText('@Coder')).toBeDefined()
    expect(screen.getByText('@Reviewer')).toBeDefined()
    expect(screen.getByText('@Tester')).toBeDefined()
    expect(screen.getByText('@AgentWorkExecutor')).toBeDefined()

    fireEvent.click(screen.getByText('@Architect'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '@Architect '
      })
    )
  })

  it('renders Matt Pocock skills when trigger is /', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ComposerAutocompletePopover
        trigger="/"
        query=""
        contextScope="project"
        onSelect={onSelect}
        onClose={onClose}
      />
    )

    expect(screen.getByText('/ask-matt')).toBeDefined()
    expect(screen.getByText('/tdd')).toBeDefined()
    expect(screen.getByText('/code-review')).toBeDefined()
    expect(screen.getByText('/plan')).toBeDefined()
    expect(screen.getByText('/grill-me')).toBeDefined()
    expect(screen.getByText('/implement')).toBeDefined()

    fireEvent.click(screen.getByText('/tdd'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        insertText: '/tdd '
      })
    )
  })
})
