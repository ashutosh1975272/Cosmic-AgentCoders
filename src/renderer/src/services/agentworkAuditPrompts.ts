/**
 * Specialized non-coding audit & verification prompt suites for AgentWork.
 * These prompt templates are dispatched to AgentWork to run comprehensive
 * security, code quality, QA assertions, and two-axis reviews.
 */

export interface AuditSuiteDefinition {
  id: 'security' | 'quality' | 'qa' | 'two-axis' | 'gate'
  name: string
  icon: string
  role: string
  targetAgent: string
  description: string
  recommendedEngine?: string
  generatePrompt: (projectName: string, context?: string) => string
}

export const AUDIT_SUITES: AuditSuiteDefinition[] = [
  {
    id: 'security',
    name: 'Security & Secret Leak Audit',
    icon: '🛡️',
    role: 'Security Auditor',
    targetAgent: 'Architect / Security Bot',
    description: 'Audits credentials, unescaped inputs, injection vectors, and sandbox boundaries.',
    generatePrompt: (projectName: string, context?: string) => `
You are acting as the Chief Security Auditor for the "${projectName}" repository.
Perform a rigorous, non-destructive security and vulnerability scan.

Target Scope:
${context || 'Full workspace codebase, configuration files, and IPC boundary bridges.'}

Audit Requirements:
1. Credentials & Secrets: Scan for hardcoded API keys, JWT tokens, OAuth client secrets, private keys, or .env files mistakenly bundled.
2. Sandbox & Isolation: Verify that file system writes, child processes, and network requests strictly respect the sandboxed boundaries.
3. Injection & Sanitization: Inspect IPC channels and API handlers for SQL injection, command execution vulnerabilities, or prototype pollution.
4. Access Control: Verify that session partition isolation (e.g. persist:card-*) prevents cross-tenant data leaks.

Return a structured markdown report with:
- Summary score (Passed / At Risk / Critical)
- Identified vulnerabilities with file links and exact severity
- Concrete remediation diffs for any flagged issues.
`.trim()
  },
  {
    id: 'quality',
    name: 'Code Quality & Depth Audit',
    icon: '🏛️',
    role: 'Deep Codebase Architect',
    targetAgent: 'Architect',
    description: 'Audits modular depth, interface boundaries, strict TypeScript typing, and DRY principles.',
    generatePrompt: (projectName: string, context?: string) => `
You are acting as the Lead Software Architect for "${projectName}".
Perform a deep codebase design and code quality audit.

Target Scope:
${context || 'All core application modules, components, and shared services.'}

Audit Requirements:
1. Deep Modules vs Shallow Interfaces: Flag modules with shallow abstractions or unnecessary pass-through layers.
2. Type Safety & Integrity: Verify TypeScript strict mode compliance, absence of arbitrary 'any' casts, and proper error typing.
3. Coupling & Cohesion: Identify circular dependencies, monolithic files (>1500 lines), or high-churn coupling hotspots.
4. Error Handling: Confirm that all asynchronous operations fail soft with clear user diagnostics.

Provide:
- Architecture Health Rating (A/B/C/D)
- Seam and abstraction improvements
- Clean code refactoring checklist.
`.trim()
  },
  {
    id: 'qa',
    name: 'QA & Test Matrix Verification',
    icon: '🧪',
    role: 'QA Testing Lead',
    targetAgent: 'QA Tester',
    description: 'Verifies assertion density, edge cases, mutation coverage, and mock reliability.',
    generatePrompt: (projectName: string, context?: string) => `
You are acting as the Senior QA Automation Engineer for "${projectName}".
Perform a comprehensive test suite verification.

Target Scope:
${context || 'Unit tests, UI tests, integration tests, and edge case coverage.'}

Audit Requirements:
1. Assertion Integrity: Verify tests make meaningful assertions and avoid false-positive green tests.
2. Edge Cases: Test edge conditions including empty inputs, null pointers, offline networks, session expiration, and race conditions.
3. Regression Protection: Ensure existing passing test invariants remain preserved.
4. Flakiness Analysis: Identify any asynchronous timers, unawaited promises, or environment-dependent tests.

Provide:
- Test Matrix Coverage Summary
- Missing Edge Case Scenarios
- Step-by-step test synthesis plan.
`.trim()
  },
  {
    id: 'two-axis',
    name: 'Two-Axis Spec & Standards Review',
    icon: '🔍',
    role: 'Code Reviewer',
    targetAgent: 'Reviewer',
    description: 'Evaluates implementation along Two Axes: Spec Compliance and Codebase Standards.',
    generatePrompt: (projectName: string, context?: string) => `
You are acting as the Independent Code Reviewer for "${projectName}".
Conduct a side-by-side Two-Axis Code Review.

Target Scope:
${context || 'Latest feature implementation, UI changes, and IPC handlers.'}

Axis 1: Spec Compliance
- Does the code fulfill all specific user requests and approved plan items?
- Are there any missing edge cases, unimplemented placeholders, or stubbed functions?

Axis 2: Standards Compliance
- Does the implementation follow this repository's established code style, linting rules, and naming conventions?
- Are tests comprehensive, clean, and fast?

Provide:
- Spec Verdict (PASS / REVISE)
- Standards Verdict (PASS / REVISE)
- Actionable review feedback items.
`.trim()
  },
  {
    id: 'gate',
    name: 'Head Agent Supreme Gatekeeper',
    icon: '👑',
    role: 'Supreme Swarm Orchestrator',
    targetAgent: 'Head Agent',
    description: 'Aggregates Security, Quality, QA, and Review scores into a final deployment gate.',
    generatePrompt: (projectName: string, context?: string) => `
You are the Supreme Swarm Orchestrator for "${projectName}".
Synthesize an executive multi-agent deployment readiness report.

Target Scope:
${context || 'Complete project state across Security, Architecture, Testing, and Spec Compliance.'}

Gate Checklist:
1. Security: Zero critical or high severity vulnerabilities.
2. Test Suite: 100% pass rate with zero flaky tests.
3. Build & Typecheck: Clean compilation with zero TypeScript errors.
4. User Experience: Seamless UI feedback, no blank screens, robust offline handling.

Deliver:
- Final Gate Decision: [APPROVED FOR SHIP] or [BLOCKED]
- Executive Summary of all verification vectors.
`.trim()
  }
]
