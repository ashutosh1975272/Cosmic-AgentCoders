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

export interface SwarmMessage {
  id: string
  senderId: SwarmAgentId | 'user'
  senderName: string
  text: string
  timestamp: string
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

  setActiveAgent: (id: SwarmAgentId) => void
  postMessage: (agentId: SwarmAgentId, message: Omit<SwarmMessage, 'id' | 'timestamp'>) => void
  dispatchTaskFromHead: (goal: string) => void
  updateTaskStatus: (
    taskId: string,
    status: SwarmTask['status'],
    progress: number,
    summaryUpdate?: string
  ) => void
  resetSwarm: () => void
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

  setActiveAgent: (id) => set({ activeAgentId: id }),

  postMessage: (agentId, message) => {
    const newMsg: SwarmMessage = {
      ...message,
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
      isOrchestrating: false
    })
  }
}))
