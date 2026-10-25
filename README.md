# Stillpoint — hands-free learning

A browser MVP for training companies: learners can optionally pause a video by turning away and resume an assistant-paused lesson after returning. Camera processing runs on the learner's device. The original Python experiment remains in `src/`.

**[Open the browser demo](https://xrishis.github.io/head-motion-video-control/)** · **[Source repository](https://github.com/xrishis/head-motion-video-control)**

**[Download the Chrome/Edge extension](https://github.com/xrishis/head-motion-video-control/releases/download/extension-v0.2.0/stillpoint-extension-v0.2.0.zip)** · [Installation and compatibility](EXTENSION.md)

The product is a playback assistant. Head orientation does not establish attention, comprehension, attendance, or completion.

## Run the browser demo

Requires Node.js 22.12 or newer and npm.

```sh
cd browser
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. Keep the terminal running. The demo includes its own 60-second silent lesson; it does not need a video service or API key.

1. Press Play to start the sample, or **Open your video** to select a local MP4/WebM. Local files use a browser object URL and are never uploaded.
2. Choose **Try without a camera** for a clearly labelled simulation. **Look away**, **Face screen**, and **Leave frame** drive the same playback policy as tracking.
3. For actual tracking, choose **Enable camera**, grant video permission, face the screen, and hold naturally still for approximately two seconds to calibrate.
4. Adjust the pause delay, return delay, and sensitivity. Automatic resume is off by default.
5. **Snooze assistant** suspends automatic actions while retaining the camera session. **Disable** stops camera capture and tracking. Leaving the tab stops the camera and pauses the lesson; returning requires explicit Play/Enable.

HTTPS or localhost is required for camera access. Desktop Chrome is the initial target. Mobile layout is responsive, but mobile camera tracking is not a supported pilot target.

## Behavior you can rely on in the MVP

- Facing, away, absent, and uncertain observations are separate.
- A sustained turn or absence can pause playing media after the configured delay.
- Automatic resume requires an assistant-owned pause and a confident, sustained return.
- Manual playback actions, seeking, source changes, end of media, disable, camera failures, and tab visibility changes clear stale resume ownership.
- Camera permission denial and model/runtime failures leave normal playback and simulation available.
- Each camera session has at most one inference frame in flight, bounded frame size/rate, initialization and stall timeouts, and cleanup for late asynchronous replies.
- Observations expire after 350 ms, before the shortest return delay. Stalled inference becomes uncertain instead of continuing to act on a cached head position.
- The original sample is silent. Volume controls are available for your own videos with audio.

## Architecture

```text
React player + explicit learner controls
       ↑
Pure playback policy ← calibrated orientation / labelled simulation
                              ↑
                    bounded camera capture
                              ↑
                  MediaPipe worker (local assets)
```

`browser/src/core/playbackPolicy.ts` contains deterministic timing and pause ownership. `browser/src/core/pose.ts` contains orientation math, hysteresis, and neutral calibration. `browser/src/tracking/` owns model inference and camera cleanup. `browser/src/hooks/usePlaybackAssistant.ts` connects the policy to actual HTML video events. UI components do not send keyboard input to other applications.

There is no backend, account database, analytics endpoint, camera recording, or video-upload service. The app downloads JavaScript, Wasm, the model bundle, and the sample lesson from its own host. Local videos and transient camera data remain in the browser. Session activity is bounded in-memory text and clears on reload.

## Verify and build

```sh
cd browser
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

`npm test` checks the pure policy, pose geometry, and camera observation/calibration boundary. Playwright exercises real video playback, simulation, manual override, local file handling, camera-denial recovery, and responsive UI. Controlled fake-camera checks verify model/worker initialization and cleanup without accessing a person's webcam.

`npm run build` runs TypeScript before producing `browser/dist/`. Runtime/model assets are included in `public/`, so deployment does not rely on a third-party inference CDN. Relative Vite asset paths support GitHub Pages project URLs.

## Deployment

`.github/workflows/pages.yml` runs unit tests, a production build, and Playwright before deploying the static build to GitHub Pages. Set the repository's Pages source to GitHub Actions. The workflow deploys pushes to `main` and can be started manually. Pull requests run verification without deployment.

## Build prompt and design

- [Reusable execution prompt](BUILD_PROMPT.md)
- [Extension execution prompt](EXTENSION_BUILD_PROMPT.md)
- [Product specification](docs/superpowers/specs/2026-10-25-browser-mvp-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-25-browser-mvp.md)
- [Primary-screen visual concept](docs/design/stillpoint-concept.png)
- [Original sample-media provenance and regeneration](browser/public/demo/README.md)
- [Third-party asset sources](browser/THIRD_PARTY.md)

## Current limits

Human-camera accuracy and learner preference still require testing across representative users, lighting, glasses, posture, and hardware. Automated fixtures do not prove those outcomes. This MVP integrates a native HTML video element; restricted or cross-origin training players require a supported player API and appropriate embedding/camera permissions. It is not a universal controller for other tabs or desktop apps.

Before a company pilot, validate the exact player, browser/device matrix, wanted interaction, privacy review, and support expectations with the training provider.
