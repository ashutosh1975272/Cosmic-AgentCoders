// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { AUDIT_SUITES } from '../../src/renderer/src/services/agentworkAuditPrompts'

describe('agentworkAuditPrompts', () => {
  it('defines 5 non-coding audit suites', () => {
    expect(AUDIT_SUITES).toHaveLength(5)
    const ids = AUDIT_SUITES.map((s) => s.id)
    expect(ids).toEqual(['security', 'quality', 'qa', 'two-axis', 'gate'])
  })

  it('generates non-empty prompt for security audit', () => {
    const sec = AUDIT_SUITES.find((s) => s.id === 'security')!
    const prompt = sec.generatePrompt('Orbit-Dashboards', 'IPC Handlers')
    expect(prompt).toContain('Chief Security Auditor')
    expect(prompt).toContain('Orbit-Dashboards')
    expect(prompt).toContain('IPC Handlers')
    expect(prompt).toContain('Credentials & Secrets')
  })

  it('generates non-empty prompt for QA test matrix', () => {
    const qa = AUDIT_SUITES.find((s) => s.id === 'qa')!
    const prompt = qa.generatePrompt('Orbit-Dashboards')
    expect(prompt).toContain('Senior QA Automation Engineer')
    expect(prompt).toContain('Assertion Integrity')
  })

  it('generates prompt for two-axis review', () => {
    const review = AUDIT_SUITES.find((s) => s.id === 'two-axis')!
    const prompt = review.generatePrompt('Orbit-Dashboards')
    expect(prompt).toContain('Axis 1: Spec Compliance')
    expect(prompt).toContain('Axis 2: Standards Compliance')
  })
})
