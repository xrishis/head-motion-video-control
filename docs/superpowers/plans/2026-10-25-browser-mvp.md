# Browser MVP Implementation Plan

> **For agentic workers:** Execute the independent tasks with focused agents and review the integrated app before completion. Steps use checkbox syntax for tracking.

**Goal:** Deliver a running, verified browser demo of opt-in head-controlled video playback.

**Architecture:** React UI owns media lifecycle and user intent. Pure policy and pose modules feed a native video adapter. MediaPipe inference runs in a bounded worker with local model/runtime assets.

**Tech Stack:** React, TypeScript, Vite, MediaPipe Tasks Vision, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-browser-mvp-design.md`

## Global Constraints

- Preserve Python; implement within `browser/`.
- Never mutate the enclosing home-directory Git repository.
- Camera requires explicit learner action, video only. No camera/landmark uploads.
- Auto-resume defaults off and requires assistant pause ownership.
- Model/runtime assets local; simulation is explicitly labelled.
- Desktop Chrome is the primary target; keep smaller layouts usable.

## Review Focus

- Late camera/model promises after disable must not reopen or leak capture.
- Manual media actions and late play promises must not resume a lesson unexpectedly.
- Source changes, backgrounding, and ended media must clear stale ownership.
- Frame work must remain bounded; stalls yield a usable manual-control state.
- Camera errors and absent faces must never become a confident return.

## Task 1: Scaffold and concept

- [x] Create package/configuration and a complete primary-screen visual concept.
- [x] Derive tokens/components from the concept; save the concept for comparison.
- [x] Install dependencies and local model/runtime/sample assets.

## Task 2: Playback policy

Files: `browser/src/core/playbackPolicy.ts` and corresponding `.test.ts`.

Interfaces: `PoseState = 'facing' | 'away' | 'absent' | 'unknown'`; `PlaybackPolicy` exposes `configure`, `observe`, `manualAction`, `reset`, and `snapshot`. Observation accepts pose, timestamp, and actual paused state. Decisions are `'pause' | 'resume' | null`. Snapshot exposes `ownsPause`, `pending`, and `progress`.

- [x] Write failing sequence tests for sustained-away pause, return resume, no default resume, manual override, unknown/absent, clock/timer reset, source reset.
- [x] Implement the smallest deterministic policy and rerun its tests.

## Task 3: Pose/calibration

Files: `browser/src/core/pose.ts` and corresponding `.test.ts`.

Interfaces: exported `Orientation { yaw: number; pitch: number; roll: number }`; `orientationFromMatrix(data: readonly number[]): Orientation | null`; `classifyOrientation(current, baseline, wasAway, threshold): PoseState`; `NeutralCalibration` with `add(orientation, now)`, `reset()`, `progress`, `baseline`, `status`.

- [x] Write failing known-geometry/invalid-matrix/calibration-jitter tests.
- [x] Implement math, hysteresis, robust stable calibration; run tests.

## Task 4: UI and media controls

Files: app shell, player, assistant panel, settings, simulation controls, CSS.

- [x] Add a browser test asserting page identity and sample playback before implementation.
- [x] Implement the concept with actual video play/pause, seek, volume, source input, and labelled simulation.
- [x] Integrate policy using explicit manual intent and source reset.
- [x] Verify simulation pause/resume/manual override in the browser.

## Task 5: Real camera tracking

Files: tracker worker, tracking hook/controller, calibration UI.

- [x] Add tests for explicit camera consent, failure fallback, and cleanup.
- [x] Implement dynamic worker/model startup, bounded inference, calibrated pose, errors and cancellation.
- [x] Verify model initialization with controlled camera fixtures and accurate unsupported-state reporting.

## Task 6: Review, verify, and deliver

- [x] Run the complete unit/browser suites, TypeScript, and production build.
- [x] Capture desktop/mobile screenshots outside committed source; compare against concept.
- [x] Review integrated code for ownership/lifecycle/privacy bugs and fix findings.
- [x] Write setup/architecture/provenance/limitations README.
- [x] Start/open the demo and return working URL, prompt file, test results, and remaining human-camera validation.
