# Dual-Repo Stabilization & AgentWork Boundary Enforcement Policy

This document serves as the **single authoritative specification** governing the separation of concerns, repository boundaries, and stabilization procedures between **Final-Cosmic-Application** and **Cosmic-AgentCoders**.

---

## 1. Executive Summary & Golden Invariants

### 🏛️ The Two Repositories
1. **`Final-Cosmic-Application`** (Clean Production Release)
   - **GitHub Remote:** `https://github.com/yamilogic/Final-Cosmic-Application.git` (Git remote: `final-cosmic`)
   - **Purpose:** Production-grade, modular multi-platform desktop application providing seamless integration with **Slack**, **Microsoft Teams**, and **WhatsApp Web**, multi-profile isolation, and desktop dashboard capabilities.
   - **HARD RULE:** **NEVER PUSH AGENTWORK CONTROL CODE HERE.** This repository must remain 100% clean, modular, and free of proprietary AgentWork control components, agent cockpits, or swarm hooks.
   - **STABILIZATION GATE:** Pushes to this repository occur **ONLY** after all code changes are thoroughly tested, stabilized, typechecked, and verified.

2. **`Cosmic-AgentCoders`** (AgentWork & Swarm Development)
   - **GitHub Remote:** `https://github.com/ashutosh1975272/Cosmic-AgentCoders.git` (Git remote: `agentcoders`)
   - **Target Branch:** `feat/agentcoders-swarm`
   - **Purpose:** All AgentWork-specific features, autonomous agent swarms, Agent Cockpit UI, agent messaging, and AI orchestration workflows.
   - **RULE:** All AgentWork controls and swarm enhancements live and are pushed **exclusively** to this repository.

---

## 2. Remote Matrix Reference

| Remote Name | Remote URL | Allowed Content | Stabilization Requirement |
|---|---|---|---|
| `final-cosmic` | `https://github.com/yamilogic/Final-Cosmic-Application.git` | Pure multi-platform app (Slack, Teams, WhatsApp suites, thin bar, control modals, session isolation). **0% AgentWork control code.** | Full stabilization (Gates 1–4 passed) |
| `agentcoders` | `https://github.com/ashutosh1975272/Cosmic-AgentCoders.git` | All AgentWork code, Agent Cockpit, Swarm coordinator, AgentWork controls. | Feature branch testing |
| `origin` | `https://github.com/yamilogic/Cosmic-Autonomous-Agent.git` | Core development upstream (`feat/teams-whatsapp-control`). | Continuous integration |

---

## 3. What Belongs in `Final-Cosmic-Application`

The following modular components are strictly whitelisted for `Final-Cosmic-Application`:

- **Modular Platform Suites (`src/main/platforms/`)**:
  - `src/main/platforms/registry.ts`: Extensible `PlatformBackendRegistry` supporting 3 to 30+ platforms.
  - `src/main/platforms/slack/slack-platform-suite.ts`: Direct API + Browser DOM fallback.
  - `src/main/platforms/teams/teams-platform-suite.ts`: TeamsReaderView discovery and background scraping.
  - `src/main/platforms/whatsapp/whatsapp-platform-suite.ts`: WhatsAppReaderView rapid store and DOM scraping.
- **Universal Platform Controls (`src/renderer/src/platforms/components/`)**:
  - `PlatformThinBar.tsx`: Clean embedded navigation with `⚙️ Control` and `Re-authenticate`.
  - `PlatformControlModal.tsx`: Universal control modal dispatcher.
  - `TeamsControlModal.tsx`, `WhatsAppControlModal.tsx`, `SlackControlModal.tsx`: Granular per-platform permission matrices and real-time scrape audit logs.
- **Session Isolation & Multi-Profile (`src/main/profiles/`)**:
  - Strict Electron session partitioning (`persist:profile-<id>-<platform>`).
  - Google session authentication sync without cross-profile leakage.
- **Core Desktop App Framework**:
  - `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`.
  - Clean packaging configuration (`electron-builder.yml`, `electron.vite.config.ts`, `build/`, `resources/`).
  - Full test suites in `tests/` (117 test files, 1,081 tests).

### ❌ What is Prohibited in `Final-Cosmic-Application`:
- AgentWork control components or Agent Cockpit tabs.
- AgentWork autonomous swarm hooks or unvetted experimental controls.
- Chat transcript dumps (`conversation_transcript_export.txt`).
- Scratch UI mockups (`orbit_card_sidebar_redesign.html`).
- Obsolete verification notes (`orbit-master-verification.md`) or debug bash scripts (`debug-dashboard.sh`).
- Heavy documentation directories (`docs/`, `.agents/`, `.superpowers/`).

---

## 4. Pre-Push Stabilization Gate (The 4-Step Checklist)

Before pushing any commit to `final-cosmic`, every engineer and AI agent **MUST** execute the four stabilization gates:

```bash
# Gate 1: Full Typecheck (Zero Node and Web errors)
npm run typecheck

# Gate 2: Full Test Suite Execution (All 117 files, 1,081 tests pass)
npm test

# Gate 3: Packaging & Unpacked Build Check (Exit code 0)
npm run build:unpack

# Gate 4: Boundary & Anti-Bloat Verification
npm run verify:boundary
```

If **any** gate fails, the push is **BLOCKED** until resolved.

---

## 5. Step-by-Step Push Protocols

### A. Pushing Stabilized Updates to `Final-Cosmic-Application`
When a multi-platform feature or fix is 100% stabilized and verified:

```bash
# 1. Ensure you are on the clean development branch
git checkout feat/teams-whatsapp-control

# 2. Run the 4 stabilization gates
npm run typecheck
npm test
npm run verify:boundary

# 3. Synchronize cleanly with final-cosmic/main
git push final-cosmic feat/teams-whatsapp-control:main
```

### B. Pushing AgentWork Code to `Cosmic-AgentCoders`
When working on AgentWork controls, cockpits, or swarm features:

```bash
# 1. Switch to the AgentCoders Swarm branch
git checkout feat/agentcoders-swarm

# 2. Merge clean platform updates if needed
git merge feat/teams-whatsapp-control -m "merge: incorporate stabilized platform suite updates"

# 3. Commit AgentWork enhancements
git add .
git commit -m "feat(agentwork): enhance agent cockpit and swarm controls"

# 4. Push EXCLUSIVELY to the agentcoders remote
git push agentcoders feat/agentcoders-swarm
```

---

## 6. Summary Invariant

> **Remember:**
> - **`Final-Cosmic-Application`** = Stable, pure, clean, modular multi-platform workspace. **Zero AgentWork controls.**
> - **`Cosmic-AgentCoders`** = All AgentWork code, controls, and swarm features live here.
> 
> Keep the boundary clean, verified, and permanent.
