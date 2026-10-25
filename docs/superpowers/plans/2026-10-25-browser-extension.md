# Downloadable Browser Extension Implementation Plan

> **For agentic workers:** Execute focused independent tasks with shared typed interfaces, then review the integrated package. Track steps with checkboxes.

**Goal:** Ship a downloadable MV3 extension controlling supported videos on a selected browser tab.

**Architecture:** A visible React side panel reuses local camera tracking; the service worker validates/routes typed messages to one selected tab; its content controller uses the existing playback policy and actual video events.

**Tech Stack:** Existing React/TypeScript/Vite, Chrome MV3 APIs, esbuild IIFE content bundle, fflate ZIP packaging, Vitest and persistent-context Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-browser-extension-design.md`

## Global Constraints

- Preserve browser demo/Python, no remote model runtime, microphone, analytics, or blanket installed host access.
- Use optional per-origin permission plus activeTab; no injection into restricted pages.
- Auto-resume off by default, same-video assistant ownership, synchronous capture freshness checks.
- Keep model visible side panel; panel close/disconnect expires control.
- ZIP manifest at root, include all local runtime/model/license files, no node_modules/secrets.

## Review Focus

- Source/tab/session/worker restarts must not resurrect ownership.
- Late async play and manual media events must preserve the user's last intent.
- Expired, future, reordered or spoofed observations cannot control playback.
- Content reinjection cannot stack timers or listeners.
- Extension CSP and actual packaged URLs must permit local worker/model initialization.

## Task 1: Shared protocol and packaging

Files: `browser/src/extension/protocol.ts`, `browser/panel.html`, `browser/vite.extension.config.ts`, `browser/scripts/build-extension.mjs`, `browser/scripts/package-extension.mjs`, manifest/icons, package scripts.

- [ ] Define validated settings/session/message contract.
- [ ] Build panel/background as ES modules, content as IIFE; copy shared runtime/model/license assets.
- [ ] Package a versioned ZIP with root manifest and verify entries.

## Task 2: Content playback controller

Files: `browser/src/extension/videoController.ts`, `.test.ts`, `content.ts`.

- [ ] Write failing meaningful sequence/selection/freshness tests.
- [ ] Implement one visible video selection, playback events, session resets, same-video ownership and tick-time signal age checks.
- [ ] Expose typed messages and status, make reinjection idempotent.

## Task 3: Routing and permissions

Files: `browser/src/extension/background.ts` and focused tests if helpers are factored.

- [ ] Implement toolbar open/attach and panel requests, sender validation, session storage, current tab/navigation invalidation.
- [ ] Forward only matching-session valid signals; content code independently validates freshness.
- [ ] Handle no access, no video, closed tabs and worker restart; no broad default permissions.

## Task 4: Side panel

Files: `browser/src/extension/PanelApp.tsx`, `panel.tsx`, `panel.css`.

- [ ] Reuse existing design/preferences/calibration hook with target tab display and real user consent.
- [ ] Add camera and labelled simulation modes, settings, explicit video commands, stop and compatibility feedback.
- [ ] Expire controls when panel closes, changes target, hides or fails.

## Task 5: Verify, review and distribute

- [ ] Load unpacked built extension in isolated persistent Chromium and exercise real video control across pages.
- [ ] Verify real model/worker under extension CSP with fake camera, packaging inventory, permission denial and lifecycle behavior.
- [ ] Run existing web/unit checks and extension suites; review/fix concrete issues.
- [ ] Publish source + GitHub Release ZIP, update demo download link/instructions and verify live download.
