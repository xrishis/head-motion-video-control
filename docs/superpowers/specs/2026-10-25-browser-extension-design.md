# Stillpoint downloadable extension

## Intent and approved direction

The user requested converting the working browser MVP into a downloadable browser extension after discussing YouTube, Netflix, and other browser video pages. Build the extension and publish a downloadable package to the existing xrishis GitHub project. Keep the existing website and Python experiment working.

## Approach

Use Manifest V3 with a persistent visible side panel, a small routing service worker, and an explicitly injected content script controlling one top-level video. Reuse the existing calibration/model worker and pure playback policy. The side panel retains the existing Stillpoint visual system.

A popup closes during browsing and would lose its camera. An offscreen background camera would need additional lifecycle, consent, and background-use behavior. The first downloadable version uses a visible side panel so the learner can always see camera status and stop controls. Chrome/Edge desktop are the target; use Chrome 116+ APIs.

## Permissions and media scope

Declare activeTab, scripting, sidePanel, storage, and optional HTTP/HTTPS site origins. Do not request blanket access on installation. Clicking the toolbar selects a target tab and grants temporary activeTab access. A panel gesture may optionally grant that selected origin. Request camera video only after explicit Enable camera, never audio. Package all model/runtime assets; extension CSP permits self scripts and wasm-unsafe-eval, not unsafe-eval or remote scripts.

Control one video in the top-level document: prefer the main YouTube player, otherwise the largest visible standard video. Handle dynamic replacement and media source/navigation changes. Cross-origin embedded players, closed shadow roots, protected browser pages, unsupported player APIs, fullscreen/panel closure and PiP/background control are not universal guarantees. Netflix uses generic video control initially and must be labelled unverified without an authenticated playback test. Do not bypass DRM.

## State and safety

The panel owns camera or clearly labelled simulation observations. Each target session has a random token. Messages are validated, sender-limited, sequenced and freshness-limited. Capture timestamps use performance.timeOrigin + performance.now across contexts, age limit350ms. The content controller checks age immediately before decisions, independent of timers. No stale observation can resume or pause a video.

Auto-resume defaults off and requires ownership of the same video's pause. User pause/play/seek, media replacement/source change, navigation, target-tab change, camera failure/stop, panel closure, stale session and disconnect clear ownership. Preserve manual playback, never autoplay on reconnect. Keep state in chrome.storage.session for service-worker restarts, preferences only in chrome.storage.local. No frames/landmarks/page content are uploaded.

## Distribution and verification

Produce extension-dist/ with manifest at its root and a versioned ZIP artifact. Use a GitHub Release download and installation instructions: extract ZIP, Chrome/Edge extensions page, Developer mode, Load unpacked. This is a developer-install package, not a Chrome Web Store listing or one-click CRX installer.

Test pure adapter/session behavior and load the packaged extension in isolated persistent Playwright Chromium. Verify real cross-tab media pause/resume, manual pause, session/source resets, missing videos, permission boundaries, expiration, and real local model initialization under extension CSP using fake camera input. Keep human head-tracking and authenticated streaming-site claims distinct from verified behavior.
