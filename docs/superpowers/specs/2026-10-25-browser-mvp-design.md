# Browser MVP design

The user approved building the scoped browser MVP and requested a reusable execution prompt followed by execution. `BUILD_PROMPT.md` captures that instruction.

## Intent

Demonstrate useful, optional hands-free video playback to a training company. One local browser application, one native HTML video adapter, no backend. Existing Python files remain intact.

## Approach

Use a React + TypeScript + Vite application in `browser/`. A pure playback policy receives timestamped head observations and emits pause/resume decisions. A pure pose module derives yaw/pitch from the facial transformation matrix and collects a stable neutral calibration. A worker runs locally bundled MediaPipe inference. The UI owns camera/video lifecycle, user intent, settings, and explanatory state.

Alternatives considered: packaging the Python desktop application retains focus-dependent shortcuts and installer costs; a browser extension adds distribution and cross-site permissions. The approved browser MVP reaches a controllable video element directly.

## Experience

An airy, calm training workspace named Stillpoint, with a large lesson/player area, a slim session-assistant panel, and lower lesson notes. White/very light neutral canvas, charcoal text, restrained dark-green accent. All controls are actual HTML elements. Camera is opt-in; simulation is visibly labelled. The user can select a local video without upload.

## Behavior

Default pause delay 2 seconds, return delay 1 second, auto-resume off. Facing/away/absent/unknown are distinct. Manual pauses, source changes, disabling, hidden tabs, camera errors, and ended playback clear assistant resume ownership. Paused-by-assistant ownership is required for automatic resume. On backgrounding, suspend tracking and require explicit playback after return. Settings changes reset pending timers.

Calibration samples stable neutral observations over roughly 2 seconds and requires a minimum sample count; jitter or significant head movement requests a retry. Start with one face only; ambiguous/multiple face observations become unknown. No frames or landmarks are stored or transmitted. Model assets and app bundles are served locally.

## Acceptance

Unit tests cover policy sequencing, ownership, timing, ambiguous observations, pose math, and calibration. Browser tests cover real video playback, simulation, settings, file handling, errors, and responsive layout. A controlled fake-camera test may verify worker/model initialization and cleanup, but does not establish human pose accuracy. Run TypeScript, production build, and the full browser suite before delivery.

## Boundaries

No attention/comprehension scores, identities, backend accounts, billing, cloud video hosting, desktop packaging, or universal player integrations. The UI describes tracking confidence and camera state without claiming to measure attention.
