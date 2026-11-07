import { create } from 'zustand'

export type SwarmAgentId = 'head' | 'architect' | 'coder' | 'reviewer' | 'tester' | 'executor'

export interface SwarmAgentMeta {
  id: SwarmAgentId
  name: string
  handle: string
  role: string
  icon: string
  priority: '1st (Matt Pocock)' | '2nd (Ruflo Swarm)'
  skills: string[]
  accentColor: string
}

export const SWARM_AGENTS: SwarmAgentMeta[] = [
  {
    id: 'head',
    name: 'Head Agent',
    handle: '@HeadAgent',
    role: 'Supreme Swarm Orchestrator & Planner',
    icon: '👑',
    priority: '1st (Matt Pocock)',
    skills: ['/ask-matt', '/plan', '/grill-me'],
    accentColor: '#eab308'
  },
  {
    id: 'architect',
    name: 'Architect',
    handle: '@Architect',
    role: 'Deep Codebase Design & Domain Modeling',
    icon: '🏗️',
    priority: '1st (Matt Pocock)',
    skills: ['/codebase-design', '/domain-modeling', '/prototype'],
    accentColor: '#3b82f6'
  },
  {
    id: 'coder',
    name: 'Coder',
    handle: '@Coder',
    role: 'Autonomous TDD Implementation Engine',
    icon: '💻',
    priority: '1st (Matt Pocock)',
    skills: ['/implement', '/tdd', '/migrate-to-shoehorn'],
    accentColor: '#22c55e'
  },
  {
    id: 'tester',
    name: 'Tester',
    handle: '@Tester',
    role: 'Automated Test Suites & Bug Diagnosis',
    icon: '🧪',
    priority: '1st (Matt Pocock)',
    skills: ['/tdd', '/diagnosing-bugs'],
    accentColor: '#ec4899'
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    handle: '@Reviewer',
    role: 'Two-Axis Code Review & Git Guardrails',
    icon: '🔍',
    priority: '1st (Matt Pocock)',
    skills: ['/code-review', '/pr'],
    accentColor: '#f97316'
  },
  {
    id: 'executor',
    name: 'AgentWork Executor',
    handle: '@AgentWorkExecutor',
    role: 'Runtime Worker & MCP Execution Bridge',
    icon: '⚡',
    priority: '2nd (Ruflo Swarm)',
    skills: ['/wizard', 'mcp-exec', 'direct-cli'],
    accentColor: '#a855f7'
  }
]

export interface SwarmQueryTelemetry {
  executionTimeMs: number
  estimatedTokens: number
  promptTokens: number
  completionTokens: number
}

export interface SwarmQuery {
  id: string
  threadId: string
  parentQueryId?: string
  source: 'project_chat' | 'agentcoders_inner'
  targetAgentId: SwarmAgentId
  delegatedAgentId?: SwarmAgentId
  prompt: string
  status: 'queued' | 'analyzing' | 'delegating' | 'answering' | 'completed' | 'error'
  statusText: string
  answerText?: string
  telemetry?: SwarmQueryTelemetry
  startedAt: number
  completedAt?: number
}

export interface SwarmMessage {
  id: string
  senderId: SwarmAgentId | 'user'
  senderName: string
  text: string
  timestamp: string
  provenance?: 'project_chat' | 'agentcoders_inner'
  threadId?: string
  parentMessageId?: string
  isFollowUp?: boolean
  telemetry?: SwarmQueryTelemetry
  assignedFromHead?: boolean
  taskId?: string
  statusBadge?: string
  codeSnippet?: string
}

export interface SwarmTask {
  id: string
  title: string
  assignedTo: SwarmAgentId
  assignedAgentName: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  progress: number
  skillsUsed: string[]
  summary: string
  createdAt: string
  updatedAt: string
}

interface AgentCodersStoreState {
  activeAgentId: SwarmAgentId
  agentMessages: Record<SwarmAgentId, SwarmMessage[]>
  tasks: SwarmTask[]
  swarmGoal: string | null
  swarmProgress: number
  isOrchestrating: boolean
  activeQueries: Record<string, SwarmQuery>

  setActiveAgent: (id: SwarmAgentId) => void
  postMessage: (
    agentId: SwarmAgentId,
    message: Omit<SwarmMessage, 'id' | 'timestamp'> & Partial<Pick<SwarmMessage, 'id' | 'timestamp'>>
  ) => void
  dispatchTaskFromHead: (goal: string) => void
  updateTaskStatus: (
    taskId: string,
    status: SwarmTask['status'],
    progress: number,
    summaryUpdate?: string
  ) => void
  resetSwarm: () => void
  dispatchSwarmQuery: (params: {
    queryId?: string
    prompt: string
    targetAgentId?: SwarmAgentId
    parentQueryId?: string
    source?: 'project_chat' | 'agentcoders_inner'
  }) => Promise<SwarmQuery>
  clearQuery: (queryId: string) => void
}

const INITIAL_MESSAGES: Record<SwarmAgentId, SwarmMessage[]> = {
  head: [
    {
      id: 'm-head-0',
      senderId: 'head',
      senderName: 'Head Agent',
      text: '👑 Welcome to the AgentCoders Swarm. I am your Supreme Orchestrator. Submit your high-level coding goal here, and I will partition tasks, design the architecture with @Architect, drive TDD with @Coder & @Tester, gate code with @Reviewer, and run executions via @AgentWorkExecutor.',
      timestamp: 'Just now'
    }
  ],
  architect: [
    {
      id: 'm-arch-0',
      senderId: 'architect',
      senderName: 'Architect',
      text: '🏗️ Standing by for system architecture, deep module seams, and domain modeling. Using Matt Pocock /codebase-design and /domain-modeling.',
      timestamp: 'Just now'
    }
  ],
  coder: [
    {
      id: 'm-coder-0',
      senderId: 'coder',
      senderName: 'Coder',
      text: '💻 Ready for red-green TDD slices, feature synthesis, and shoehorn migrations. Ready to receive subtasks from @HeadAgent.',
      timestamp: 'Just now'
    }
  ],
  tester: [
    {
      id: 'm-tester-0',
      senderId: 'tester',
      senderName: 'Tester',
      text: '🧪 Test suite engine active. Watching for automated tests, vitest suites, and regression diagnosis loops via /diagnosing-bugs.',
      timestamp: 'Just now'
    }
  ],
  reviewer: [
    {
      id: 'm-rev-0',
      senderId: 'reviewer',
      senderName: 'Reviewer',
      text: '🔍 Code review gate initialized. Running 2-axis reviews: Standards + Spec adherence before any branch merge.',
      timestamp: 'Just now'
    }
  ],
  executor: [
    {
      id: 'm-exec-0',
      senderId: 'executor',
      senderName: 'AgentWork Executor',
      text: '⚡ AgentWork runtime runner connected. Standing by for physical shell, build, and MCP worker operations.',
      timestamp: 'Just now'
    }
  ]
}

export const useAgentCodersStore = create<AgentCodersStoreState>((set, get) => ({
  activeAgentId: 'head',
  agentMessages: INITIAL_MESSAGES,
  tasks: [],
  swarmGoal: null,
  swarmProgress: 0,
  isOrchestrating: false,
  activeQueries: {},

  setActiveAgent: (id) => set({ activeAgentId: id }),

  postMessage: (agentId, message) => {
    const newMsg: SwarmMessage = {
      ...message,
      id: message.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp:
        message.timestamp ||
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    set((state) => ({
      agentMessages: {
        ...state.agentMessages,
        [agentId]: [...state.agentMessages[agentId], newMsg]
      }
    }))
  },

  dispatchTaskFromHead: (goal: string) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const headMsgId = `user-${Date.now()}`

    // 1. Post user prompt in Head Agent
    const userMsg: SwarmMessage = {
      id: headMsgId,
      senderId: 'user',
      senderName: 'You',
      text: goal,
      timestamp: timeStr
    }

    // 2. Head Agent acknowledges & partitions tasks
    const taskId1 = `task-${Date.now()}-1`
    const taskId2 = `task-${Date.now()}-2`
    const taskId3 = `task-${Date.now()}-3`
    const taskId4 = `task-${Date.now()}-4`

    const initialTasks: SwarmTask[] = [
      {
        id: taskId1,
        title: 'System Design & Deep Module Boundaries',
        assignedTo: 'architect',
        assignedAgentName: 'Architect',
        status: 'in_progress',
        progress: 25,
        skillsUsed: ['/codebase-design', '/domain-modeling'],
        summary: `Defining architectural seams, data models, and contracts for "${goal.slice(0, 40)}..."`,
        createdAt: timeStr,
        updatedAt: timeStr
      },
      {
        id: taskId2,
        title: 'TDD Test Suites & Assertion Matrix',
        assignedTo: 'tester',
        assignedAgentName: 'Tester',
        status: 'pending',
        progress: 0,
        skillsUsed: ['/tdd'],
        summary: 'Writing red-stage tests before code implementation',
        createdAt: timeStr,
        updatedAt: timeStr
      },
      {
        id: taskId3,
        title: 'Feature Implementation & Synthesis',
        assignedTo: 'coder',
        assignedAgentName: 'Coder',
        status: 'pending',
        progress: 0,
        skillsUsed: ['/implement', '/tdd'],
        summary: 'Green-stage code synthesis passing test assertions',
        createdAt: timeStr,
        updatedAt: timeStr
      },
      {
        id: taskId4,
        title: 'Two-Axis Code Review (Spec + Standards)',
        assignedTo: 'reviewer',
        assignedAgentName: 'Reviewer',
        status: 'pending',
        progress: 0,
        skillsUsed: ['/code-review'],
        summary: 'Verifying diff quality, git guardrails, and spec conformance',
        createdAt: timeStr,
        updatedAt: timeStr
      }
    ]

    const headReplyMsg: SwarmMessage = {
      id: `head-${Date.now()}`,
      senderId: 'head',
      senderName: 'Head Agent',
      text: `🚀 Swarm task initiated for: "${goal}".\nI have partitioned the objective into 4 A2A subtasks across specialized agents:\n1. 🏗️ @Architect -> Deep module architecture (/codebase-design)\n2. 🧪 @Tester -> Red-stage unit/integration tests (/tdd)\n3. 💻 @Coder -> Feature implementation (/implement)\n4. 🔍 @Reviewer -> 2-axis review (/code-review)`,
      timestamp: timeStr,
      statusBadge: 'A2A ORCHESTRATION ACTIVE'
    }

    set((state) => ({
      swarmGoal: goal,
      isOrchestrating: true,
      tasks: initialTasks,
      swarmProgress: 15,
      agentMessages: {
        ...state.agentMessages,
        head: [...state.agentMessages.head, userMsg, headReplyMsg],
        architect: [
          ...state.agentMessages.architect,
          {
            id: `arch-${Date.now()}`,
            senderId: 'head',
            senderName: 'Head Agent',
            text: `📋 Assigned from Head Agent:\nTask: System Design & Deep Module Boundaries\nObjective: "${goal}"\nPlease design interfaces and deep seams.`,
            timestamp: timeStr,
            assignedFromHead: true,
            taskId: taskId1
          }
        ]
      }
    }))

    // Autonomous multi-agent progressive simulation
    setTimeout(() => {
      // Step A: Architect finishes
      get().updateTaskStatus(
        taskId1,
        'completed',
        100,
        'Architecture seams and data contracts defined successfully.'
      )
      get().postMessage('architect', {
        senderId: 'architect',
        senderName: 'Architect',
        text: '✅ Architecture specification complete. Interfaces drafted, deep seams isolated, and domain contracts locked. Handing off to @Tester for TDD test suites.',
        statusBadge: 'SPEC COMPLETED',
        codeSnippet: `// Seam definition\nexport interface SwarmExecutionPlan {\n  goal: string;\n  verified: boolean;\n}`
      })

      // Step B: Tester starts
      get().updateTaskStatus(taskId2, 'in_progress', 40, 'Writing failing tests (red stage)')
      get().postMessage('tester', {
        senderId: 'head',
        senderName: 'Head Agent',
        text: '📋 Assigned from Head Agent: Architecture completed by @Architect. Please synthesize red-stage unit and integration tests using /tdd.',
        assignedFromHead: true,
        taskId: taskId2
      })
    }, 1800)

    setTimeout(() => {
      // Step C: Tester finishes, Coder starts
      get().updateTaskStatus(taskId2, 'completed', 100, 'Test assertions generated (Red Stage ready)')
      get().postMessage('tester', {
        senderId: 'tester',
        senderName: 'Tester',
        text: '✅ Red-stage test suites compiled. Assertions verify all requirements. Passing off to @Coder for implementation.',
        statusBadge: 'RED TESTS READY'
      })

      get().updateTaskStatus(taskId3, 'in_progress', 50, 'Implementing green-stage features')
      get().postMessage('coder', {
        senderId: 'head',
        senderName: 'Head Agent',
        text: '📋 Assigned from Head Agent: Implement code to satisfy tests from @Tester.',
        assignedFromHead: true,
        taskId: taskId3
      })
    }, 3800)

    setTimeout(() => {
      // Step D: Coder finishes, Reviewer starts
      get().updateTaskStatus(taskId3, 'completed', 100, 'Code synthesis complete, all tests passing')
      get().postMessage('coder', {
        senderId: 'coder',
        senderName: 'Coder',
        text: '✅ Implementation complete! All test assertions green. Handing diff to @Reviewer.',
        statusBadge: 'GREEN PASSED'
      })

      get().updateTaskStatus(
        taskId4,
        'in_progress',
        60,
        'Reviewing diff against spec & coding standards'
      )
      get().postMessage('reviewer', {
        senderId: 'head',
        senderName: 'Head Agent',
        text: '📋 Assigned from Head Agent: Review code changes using /code-review (Standards + Spec).',
        assignedFromHead: true,
        taskId: taskId4
      })
    }, 5800)

    setTimeout(() => {
      // Step E: Reviewer approves, Swarm 100% complete
      get().updateTaskStatus(
        taskId4,
        'completed',
        100,
        'Approved: 2-axis review passed with zero blockers'
      )
      get().postMessage('reviewer', {
        senderId: 'reviewer',
        senderName: 'Reviewer',
        text: '✅ 2-Axis Code Review APPROVED! Conformance to specs: 100%. Codebase standards: 100%. Ready for merge.',
        statusBadge: 'APPROVED'
      })

      get().postMessage('head', {
        senderId: 'head',
        senderName: 'Head Agent',
        text: `🎉 Swarm orchestration 100% COMPLETED for: "${goal}".\nAll subtasks verified across @Architect, @Tester, @Coder, and @Reviewer. Ready for deployment.`,
        statusBadge: 'ALL TASKS COMPLETE'
      })

      set({ isOrchestrating: false, swarmProgress: 100 })
    }, 7500)
  },

  updateTaskStatus: (taskId, status, progress, summaryUpdate) => {
    set((state) => {
      const nextTasks = state.tasks.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            status,
            progress,
            summary: summaryUpdate || t.summary,
            updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        }
        return t
      })

      // Recompute swarm progress
      const totalProgress = nextTasks.reduce((acc, t) => acc + t.progress, 0)
      const computed = nextTasks.length > 0 ? Math.round(totalProgress / nextTasks.length) : 0

      return {
        tasks: nextTasks,
        swarmProgress: computed
      }
    })
  },

  resetSwarm: () => {
    set({
      activeAgentId: 'head',
      agentMessages: INITIAL_MESSAGES,
      tasks: [],
      swarmGoal: null,
      swarmProgress: 0,
      isOrchestrating: false,
      activeQueries: {}
    })
  },

  dispatchSwarmQuery: async ({
    queryId: customQueryId,
    prompt,
    targetAgentId = 'head',
    parentQueryId,
    source = 'project_chat'
  }) => {
    const queryId = customQueryId || `query-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const startedAt = Date.now()

    // Thread identification: link to parent if explicitly provided or valid follow-up
    const isFollowUp = Boolean(parentQueryId)
    let threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    if (parentQueryId && get().activeQueries[parentQueryId]) {
      threadId = get().activeQueries[parentQueryId].threadId
    } else if (parentQueryId) {
      threadId = parentQueryId
    }

    const targetMeta = SWARM_AGENTS.find((a) => a.id === targetAgentId) || SWARM_AGENTS[0]

    // 1. Initial State: Analyzing
    const initialQuery: SwarmQuery = {
      id: queryId,
      threadId,
      parentQueryId,
      source,
      targetAgentId,
      prompt,
      status: 'analyzing',
      statusText: `${targetMeta.icon} ${targetMeta.handle} is analyzing inquiry...`,
      startedAt
    }

    set((state) => ({
      activeQueries: {
        ...state.activeQueries,
        [queryId]: initialQuery
      }
    }))

    // 2. Post user question into history with proper sender identity
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userSenderName = source === 'project_chat' ? 'Project Master Agent (Chat)' : 'You'
    const userMsg: SwarmMessage = {
      id: `msg-user-${queryId}`,
      senderId: 'user',
      senderName: userSenderName,
      text: prompt,
      timestamp: timeStr,
      provenance: source,
      threadId,
      parentMessageId: parentQueryId,
      isFollowUp
    }
    get().postMessage(targetAgentId, userMsg)

    // Cross-post to Head Agent if direct target was another sub-agent
    if (targetAgentId !== 'head') {
      get().postMessage('head', {
        ...userMsg,
        id: `msg-sync-head-user-${queryId}`,
        statusBadge: `DIRECT DISPATCH TO ${targetAgentId.toUpperCase()}`
      })
    }

    // 3. Parallel Intent Analysis & Async Resolution
    return new Promise<SwarmQuery>((resolve) => {
      setTimeout(() => {
        const lowerPrompt = prompt.toLowerCase().trim()

        // Check if roster inquiry
        const isRosterInquiry =
          /\b(what\s+are\s+the\s+agents|tell\s+me.*agents|list.*agents|who\s+are\s+the\s+agents|available\s+agents|swarm\s+roster|agents\s+you\s+have|all\s+agents|team\s+members|what\s+agents|agents\s+name|agent\s+names|names\s+of\s+agents|tell\s+me\s+all\s+thse\s+agents)\b/i.test(
            lowerPrompt
          ) ||
          (lowerPrompt.includes('agent') &&
            (lowerPrompt.includes('have') ||
              lowerPrompt.includes('list') ||
              lowerPrompt.includes('tell') ||
              lowerPrompt.includes('name') ||
              lowerPrompt.includes('who') ||
              lowerPrompt.includes('all') ||
              lowerPrompt.includes('roster') ||
              lowerPrompt.includes('capabilities')))

        if (isRosterInquiry || (targetAgentId === 'head' && lowerPrompt.includes('who are you'))) {
          // Direct Head Agent Roster Answer detailing all 6 agents
          const answerText = `👑 **AgentCoders Swarm: Complete Roster & Agent Hierarchy**\n\nHere is the complete roster of all **6 specialized autonomous coding agents** currently initialized in the AgentCoders swarm, their orchestrator priorities, and their primary Matt Pocock & Ruflo capabilities:\n\n1. 👑 **@HeadAgent (Head Agent)** — *Supreme Swarm Orchestrator & Planner*\n   - **Priority**: 1st (Matt Pocock Orchestration)\n   - **Skills**: \`/ask-matt\`, \`/plan\`, \`/grill-me\`\n   - **Role**: High-level problem decomposition, A2A task partitioning, dependency graphs, and multi-query consensus.\n\n2. 🏗️ **@Architect (Architect)** — *Deep Codebase Design & Domain Modeling*\n   - **Priority**: 1st (Matt Pocock Deep Architecture)\n   - **Skills**: \`/codebase-design\`, \`/domain-modeling\`, \`/prototype\`\n   - **Role**: Interface definitions, isolation of deep seams, GLOSSARY & ADR management, domain data modeling.\n\n3. 💻 **@Coder (Coder)** — *Autonomous TDD Implementation Engine*\n   - **Priority**: 1st (Matt Pocock Implementation)\n   - **Skills**: \`/implement\`, \`/tdd\`, \`/migrate-to-shoehorn\`\n   - **Role**: Green-stage code synthesis, type-safe refactoring, migration to Shoehorn partial types, zero-spec-leak development.\n\n4. 🧪 **@Tester (Tester)** — *Automated Test Suites & Bug Diagnosis*\n   - **Priority**: 1st (Matt Pocock Verification)\n   - **Skills**: \`/tdd\`, \`/diagnosing-bugs\`\n   - **Role**: Red-stage assertion synthesis, vitest suite management, diagnostic regression loops, edge-case hardening.\n\n5. 🔍 **@Reviewer (Reviewer)** — *Two-Axis Code Review & Git Guardrails*\n   - **Priority**: 1st (Matt Pocock Verification)\n   - **Skills**: \`/code-review\`, \`/pr\`\n   - **Role**: Two-axis diff evaluation (Spec Conformance + Standards Adherence), git safety guardrails, pull request authoring.\n\n6. ⚡ **@AgentWorkExecutor (AgentWork Executor)** — *Runtime Worker & MCP Execution Bridge*\n   - **Priority**: 2nd (Ruflo Swarm Execution)\n   - **Skills**: \`/wizard\`, \`mcp-exec\`, \`direct-cli\`\n   - **Role**: Physical environment operations, background daemon orchestration, CLI execution, and MCP runtime integration.\n\n⚡ **Current Status**: All 6 agents are active, online, and operating with parallel query bridging and thread-isolated execution.`

          const executionTimeMs = Math.max(120, Date.now() - startedAt)
          const promptTokens = Math.max(1, Math.round(prompt.length / 4))
          const completionTokens = Math.max(1, Math.round(answerText.length / 4))
          const estimatedTokens = promptTokens + completionTokens

          const telemetry: SwarmQueryTelemetry = {
            executionTimeMs,
            estimatedTokens,
            promptTokens,
            completionTokens
          }

          // Post head agent response with provenance and telemetry
          get().postMessage('head', {
            id: `msg-ans-${queryId}`,
            senderId: 'head',
            senderName: 'Head Agent',
            text: answerText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            provenance: 'agentcoders_inner',
            threadId,
            parentMessageId: `msg-user-${queryId}`,
            isFollowUp,
            telemetry,
            statusBadge: 'ROSTER DISPATCH'
          })

          const completedQuery: SwarmQuery = {
            ...initialQuery,
            status: 'completed',
            statusText: 'Completed',
            answerText,
            telemetry,
            completedAt: Date.now()
          }

          set((state) => ({
            activeQueries: {
              ...state.activeQueries,
              [queryId]: completedQuery
            }
          }))

          resolve(completedQuery)
          return
        }

        // Domain Inquiry / Delegation Analysis
        let delegatedAgentId: SwarmAgentId | undefined = undefined

        if (targetAgentId === 'head') {
          if (
            lowerPrompt.includes('architect') ||
            lowerPrompt.includes('design') ||
            lowerPrompt.includes('seam') ||
            lowerPrompt.includes('boundary') ||
            lowerPrompt.includes('domain') ||
            lowerPrompt.includes('model')
          ) {
            delegatedAgentId = 'architect'
          } else if (
            lowerPrompt.includes('test') ||
            lowerPrompt.includes('vitest') ||
            lowerPrompt.includes('bug') ||
            lowerPrompt.includes('diagnos') ||
            lowerPrompt.includes('assertion')
          ) {
            delegatedAgentId = 'tester'
          } else if (
            lowerPrompt.includes('code') ||
            lowerPrompt.includes('implement') ||
            lowerPrompt.includes('synth') ||
            lowerPrompt.includes('shoehorn') ||
            lowerPrompt.includes('feature')
          ) {
            delegatedAgentId = 'coder'
          } else if (
            lowerPrompt.includes('review') ||
            lowerPrompt.includes('pr') ||
            lowerPrompt.includes('guardrail') ||
            lowerPrompt.includes('standard') ||
            lowerPrompt.includes('diff')
          ) {
            delegatedAgentId = 'reviewer'
          } else if (
            lowerPrompt.includes('executor') ||
            lowerPrompt.includes('runtime') ||
            lowerPrompt.includes('daemon') ||
            lowerPrompt.includes('mcp') ||
            lowerPrompt.includes('agentwork') ||
            lowerPrompt.includes('worker') ||
            lowerPrompt.includes('shell') ||
            lowerPrompt.includes('cli')
          ) {
            delegatedAgentId = 'executor'
          }
        } else {
          delegatedAgentId = targetAgentId
        }

        const delegateMeta = delegatedAgentId
          ? SWARM_AGENTS.find((a) => a.id === delegatedAgentId)
          : undefined

        if (delegateMeta && targetAgentId === 'head') {
          set((state) => ({
            activeQueries: {
              ...state.activeQueries,
              [queryId]: {
                ...state.activeQueries[queryId],
                status: 'delegating',
                delegatedAgentId,
                statusText: `👑 @HeadAgent ➔ ${delegateMeta.icon} Consulting ${delegateMeta.handle}...`
              }
            }
          }))

          // Also post the delegated inquiry into the specialist feed so specialist has the question context!
          get().postMessage(delegateMeta.id, {
            id: `msg-task-${queryId}`,
            senderId: 'head',
            senderName: 'Head Agent (via Project Chat)',
            text: `👑 **Delegated Inquiry from Head Agent**:\n*"${prompt}"*`,
            timestamp: timeStr,
            provenance: 'project_chat',
            threadId,
            parentMessageId: `msg-user-${queryId}`,
            isFollowUp,
            assignedFromHead: true,
            statusBadge: 'DELEGATED FROM HEAD'
          })
        }

        setTimeout(() => {
          let answerText = ''
          const effectiveAgentId = delegatedAgentId || targetAgentId

          if (effectiveAgentId === 'architect') {
            answerText = `🏗️ **Architect Specialist Assessment**:\n- **Domain Analysis**: Evaluated boundaries and interface contracts for: *"${prompt}"*.\n- **Deep Seams**: Designing high-leverage abstractions with narrow interfaces and deep implementations (\`/codebase-design\`).\n- **Domain Modeling**: Validated ubiquitous terminology with GLOSSARY & ADR standards (\`/domain-modeling\`).\n- **Recommendation**: Isolate dependencies behind explicit seams before implementation.`
          } else if (effectiveAgentId === 'tester') {
            answerText = `🧪 **Tester Verification Suite**:\n- **Test Strategy**: Generated test matrix and assertions for: *"${prompt}"*.\n- **Vitest Suites**: Verified red-stage coverage and failure scenarios (\`/tdd\`).\n- **Bug Diagnosis**: Isolated failure vectors and regression boundaries (\`/diagnosing-bugs\`).\n- **Status**: Test harness ready for automated verification.`
          } else if (effectiveAgentId === 'coder') {
            answerText = `💻 **Coder Autonomous Implementation**:\n- **TDD Synthesis**: Prepared to execute red-green-refactor loop for: *"${prompt}"*.\n- **Type Safety**: Enforcing zero \`as\` assertions using Shoehorn migrations (\`/migrate-to-shoehorn\`).\n- **Implementation Ready**: Unit tests green, changes isolated to domain boundaries (\`/implement\`).`
          } else if (effectiveAgentId === 'reviewer') {
            answerText = `🔍 **Reviewer Two-Axis Evaluation**:\n- **Axis 1 (Spec Adherence)**: Verified requirements against objective: *"${prompt}"*.\n- **Axis 2 (Codebase Standards)**: Enforced architectural integrity, clean diffs, and lint standards (\`/code-review\`).\n- **Git Guardrails**: Verified dangerous git operations are blocked (\`/pr\`). Status: APPROVED.`
          } else if (effectiveAgentId === 'executor') {
            answerText = `⚡ **AgentWork Executor Runtime Execution**:\n- **Target Task**: *"${prompt}"*.\n- **Platform Connection**: Connected to AgentWork runtime & MCP execution bridge.\n- **CLI / Worker Bridge**: Active on Linux workspace with live telemetry and process control (\`/wizard\`, \`mcp-exec\`).`
          } else {
            answerText = `👑 **Head Agent Orchestration Plan**:\n- **Objective**: *"${prompt}"*.\n- **Decomposition**: Analyzed scope and partitioned workflow across the 6 specialized agents.\n- **Execution Strategy**: Coordinated A2A pipeline with Matt Pocock standards and multi-agent consensus.`
          }

          const executionTimeMs = Math.max(120, Date.now() - startedAt)
          const promptTokens = Math.max(1, Math.round(prompt.length / 4))
          const completionTokens = Math.max(1, Math.round(answerText.length / 4))
          const estimatedTokens = promptTokens + completionTokens

          const telemetry: SwarmQueryTelemetry = {
            executionTimeMs,
            estimatedTokens,
            promptTokens,
            completionTokens
          }

          const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          if (effectiveAgentId !== 'head' && targetAgentId === 'head') {
            // 1. Specialist response in specialist agent feed
            get().postMessage(effectiveAgentId, {
              id: `msg-sub-${queryId}`,
              senderId: effectiveAgentId,
              senderName: delegateMeta ? delegateMeta.name : effectiveAgentId,
              text: answerText,
              timestamp: replyTime,
              provenance: 'agentcoders_inner',
              threadId,
              parentMessageId: `msg-task-${queryId}`,
              isFollowUp,
              telemetry,
              statusBadge: 'SPECIALIST REPLY'
            })
            // 2. Synthesized answer in Head Agent feed
            get().postMessage('head', {
              id: `msg-head-delegate-${queryId}`,
              senderId: 'head',
              senderName: 'Head Agent',
              text: `👑 Head Agent ➔ ${delegateMeta ? delegateMeta.handle : effectiveAgentId} Consultation:\n\n${answerText}`,
              timestamp: replyTime,
              provenance: 'agentcoders_inner',
              threadId,
              parentMessageId: `msg-user-${queryId}`,
              isFollowUp,
              telemetry,
              statusBadge: `DELEGATED TO ${effectiveAgentId.toUpperCase()}`
            })
          } else {
            // Direct reply to target agent feed
            get().postMessage(targetAgentId, {
              id: `msg-ans-${queryId}`,
              senderId: targetAgentId,
              senderName: targetMeta.name,
              text: answerText,
              timestamp: replyTime,
              provenance: 'agentcoders_inner',
              threadId,
              parentMessageId: `msg-user-${queryId}`,
              isFollowUp,
              telemetry,
              statusBadge: 'SWARM REPLY'
            })

            // Also cross-sync direct answer to Head Agent feed if target was not Head
            if (targetAgentId !== 'head') {
              get().postMessage('head', {
                id: `msg-sync-head-ans-${queryId}`,
                senderId: targetAgentId,
                senderName: targetMeta.name,
                text: answerText,
                timestamp: replyTime,
                provenance: 'agentcoders_inner',
                threadId,
                parentMessageId: `msg-sync-head-user-${queryId}`,
                isFollowUp,
                telemetry,
                statusBadge: 'SWARM REPLY'
              })
            }
          }

          const completedQuery: SwarmQuery = {
            ...initialQuery,
            status: 'completed',
            statusText: 'Completed',
            delegatedAgentId,
            answerText,
            telemetry,
            completedAt: Date.now()
          }

          set((state) => ({
            activeQueries: {
              ...state.activeQueries,
              [queryId]: completedQuery
            }
          }))

          resolve(completedQuery)
        }, 120)
      }, 100)
    })
  },

  clearQuery: (queryId: string) => {
    set((state) => {
      const next = { ...state.activeQueries }
      delete next[queryId]
      return { activeQueries: next }
    })
  }
}))
