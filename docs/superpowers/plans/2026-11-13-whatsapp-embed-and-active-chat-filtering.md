# WhatsApp Web Embed Fix & Active Message Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the WhatsApp Web black screen embed occlusion bug so WhatsApp Web renders reliably inside the main application pane, eliminate cross-platform channel leakage (Slack channels appearing in Teams/WhatsApp), and enforce strict active-chat filtering across Microsoft Teams and WhatsApp Web so that only channels and DMs with a minimum of 1 message are displayed in the control matrix, dynamically adding newly active chats upon receiving their first message.

**Architecture:** 
1. Fix view lifecycle management in `src/main/profiles/browser-view-manager.ts` and `src/renderer/src/components/dashboard/CardLiveSlackEmbed.tsx` to prevent stale `embedHidden` flags and asynchronous unmount races from detaching the view from `mainWindow.contentView`.
2. Update `<CardLiveSlackEmbed />` in `src/renderer/src/components/dashboard/WorkspaceContent.tsx` with explicit `projectId` and unique `key` props to guarantee clean React mount/unmount boundaries.
3. Enhance `src/main/whatsapp-reader/whatsapp-reader-view.ts` and `src/main/teams-reader/teams-reader-view.ts` discovery scripts to inspect message previews and message counts, completely suppressing 0-message conversations and drafts.
4. Enforce `messageCount >= 1` in `src/main/platforms/whatsapp/whatsapp-platform-suite.ts` and `src/main/platforms/teams/teams-platform-suite.ts`, and sanitize sources in `src/renderer/src/components/dashboard/WhatsAppControlModal.tsx` and `TeamsControlModal.tsx` to eliminate Slack channel leakage.

**Tech Stack:** Electron 44 (`WebContentsView`, `BrowserWindow`), React 19, TypeScript 5.8, Tailwind CSS, Vitest.

**Spec:** User request and visual evidence (`media_1794563970961_5dcf5cfd.png`), plus architectural boundary policy `FINAL_COSMIC_DUAL_REPO_STABILIZATION_POLICY.md`.

---

## Global Constraints

- **Strict Visibility:** WhatsApp Web embed view must attach and render with pixel-exact bounds beneath the thin bar without blank/black screen occlusion.
- **Strict Isolation:** Zero Slack channels or contacts (`#agentworkprojecttesting`, `@Slackbot`, `@yami`, etc.) may ever appear in Teams or WhatsApp control pages, sources, or delta stores.
- **Minimum 1 Message Rule:** Channels and DMs with 0 messages must be completely hidden. The moment a chat receives or sends its first message (`messageCount >= 1`), it must automatically appear in the channel matrix and be available for permission configuration.
- **Zero Regression:** All existing 117 test files and 1,081 tests must pass, and new tests must verify the 0-message filtering and embed attachment lifecycle.
- **Dual-Repo Boundary:** Never push AgentWork control code to `Final-Cosmic-Application`.

---

## Review Focus

1. **Stale `embedHidden` Flag:** Ensure `activateCardSlackEmbed` resets `this.embedHidden = false` so that view attachment is never skipped when previously hidden by modals or card switches.
2. **Asynchronous Unmount Race in Embed Cleanup:** Ensure `clearCardSlackEmbed` does not detach a newly activated embed when a previous component unmounts slightly late.
3. **Empty Chat & Draft Suppression:** Verify that empty spaces (e.g. Teams "This is your space" drafts with 0 messages, or WhatsApp empty contacts) are excluded from discovery.
4. **Dynamic Chat Activation:** Verify that when a message is sent or scraped in an inactive chat, the discovery engine surfaces the chat in the next sync/scrape cycle.
5. **No Cross-Platform Contamination:** Verify that Slack, Teams, and WhatsApp run logs, channels, and messages remain completely segregated in the UI and data layer.

---

## File Structure

- **Modify:** `src/main/profiles/browser-view-manager.ts` (reset `embedHidden`, clean view attachment, safe key-guarded clearing)
- **Modify:** `src/renderer/src/components/dashboard/CardLiveSlackEmbed.tsx` (call `setEmbedVisible(true)` on mount, guard cleanup)
- **Modify:** `src/renderer/src/components/dashboard/WorkspaceContent.tsx` (unique keyed instances with `projectId={project.id}`, sanitize source channels)
- **Modify:** `src/main/whatsapp-reader/whatsapp-reader-view.ts` (extract message presence/count, suppress 0-message chats in DOM and Store)
- **Modify:** `src/main/teams-reader/teams-reader-view.ts` (extract message presence/count, suppress 0-message chats and drafts in DOM)
- **Modify:** `src/main/platforms/whatsapp/whatsapp-platform-suite.ts` (enforce `messageCount >= 1` in discovery)
- **Modify:** `src/main/platforms/teams/teams-platform-suite.ts` (enforce `messageCount >= 1` in discovery)
- **Modify:** `src/renderer/src/components/dashboard/WhatsAppControlModal.tsx` (filter out Slack channels & 0-message chats, display clean empty state)
- **Modify:** `src/renderer/src/components/dashboard/TeamsControlModal.tsx` (filter out Slack channels & 0-message chats, display clean empty state)
- **Create / Modify Tests:**
  - `tests/unit/whatsapp-reader.test.ts`
  - `tests/unit/teams-reader.test.ts`
  - `tests/ui/whatsapp-control-modal.test.tsx`
  - `tests/ui/teams-control-modal.test.tsx`

---

## Tasks

### Task 1: Fix WhatsApp Web Embed Occlusion & Attachment Lifecycle in BrowserViewManager & CardLiveSlackEmbed

**Files:**
- Modify: `src/main/profiles/browser-view-manager.ts`
- Modify: `src/renderer/src/components/dashboard/CardLiveSlackEmbed.tsx`
- Modify: `src/renderer/src/components/dashboard/WorkspaceContent.tsx`
- Test: `tests/unit/browser-view-embed-lifecycle.test.ts`

- [ ] **Step 1: Write failing test in `tests/unit/browser-view-embed-lifecycle.test.ts`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement minimal code changes**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 2: Active Message Filtering & 0-Message Suppression in WhatsApp Reader & Platform Suite

**Files:**
- Modify: `src/main/whatsapp-reader/whatsapp-reader-view.ts`
- Modify: `src/main/platforms/whatsapp/whatsapp-platform-suite.ts`
- Test: `tests/unit/whatsapp-reader.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/whatsapp-reader.test.ts`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update `WHATSAPP_DISCOVER_CHATS_SCRIPT` and `whatsapp-platform-suite.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 3: Active Message Filtering & 0-Message Suppression in Teams Reader & Platform Suite

**Files:**
- Modify: `src/main/teams-reader/teams-reader-view.ts`
- Modify: `src/main/platforms/teams/teams-platform-suite.ts`
- Test: `tests/unit/teams-reader.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/teams-reader.test.ts`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update `TEAMS_DISCOVER_CHANNELS_SCRIPT` and `teams-platform-suite.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 4: Prevent Cross-Platform Leakage & Enforce Clean UI in Control Modals

**Files:**
- Modify: `src/renderer/src/components/dashboard/WhatsAppControlModal.tsx`
- Modify: `src/renderer/src/components/dashboard/TeamsControlModal.tsx`
- Modify: `src/renderer/src/components/dashboard/WorkspaceContent.tsx`
- Test: `tests/ui/whatsapp-control-modal.test.tsx`
- Test: `tests/ui/teams-control-modal.test.tsx`

- [ ] **Step 1: Write UI tests for 0-message chat suppression and platform isolation**
- [ ] **Step 2: Run UI tests to verify failure**
- [ ] **Step 3: Update `WhatsAppControlModal.tsx` and `TeamsControlModal.tsx`**
- [ ] **Step 4: Run UI tests to verify they pass**
- [ ] **Step 5: Commit**

### Task 5: End-to-End Verification & Multi-Remote Synchronization

- [ ] **Step 1: Run TypeScript verification (`npm run typecheck`)**
- [ ] **Step 2: Run Dual-Repo Boundary Check (`npm run verify:boundary`)**
- [ ] **Step 3: Run Full Vitest Test Suite (`npm test`)**
- [ ] **Step 4: Build unpack test (`npm run build:unpack`)**
- [ ] **Step 5: Git commit and push across remotes**
