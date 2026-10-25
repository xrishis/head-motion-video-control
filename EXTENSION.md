# Stillpoint browser extension

The extension connects Stillpoint's local head tracker to one selected video tab. It is separate from the standalone sample-video website.

**Download:** [Stillpoint extension v0.2.0 ZIP](https://github.com/xrishis/head-motion-video-control/releases/download/extension-v0.2.0/stillpoint-extension-v0.2.0.zip)

## Install on desktop Chrome or Edge

1. Download the ZIP and extract it into a permanent folder.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder that contains `manifest.json` directly.
5. Pin Stillpoint from the browser's extensions menu if desired.

This package uses the developer installation flow. It is not published in the Chrome Web Store or Edge Add-ons store. Double-clicking a ZIP does not install it automatically. Keep the extracted folder in place; the browser loads the extension from it.

## Use it on a video page

1. Open the video website and start its video normally once. Browsers can reject subsequent automatic playback until the website has received a user gesture.
2. Click Stillpoint's toolbar icon on that tab. The side panel displays the selected tab and video status. The optional shortcut is Alt+Shift+S; other shortcuts can conflict.
3. Keep the side panel open beside the video. Choose **Enable camera**, allow camera access, face the screen and hold comfortably still to calibrate.
4. Turn away for the chosen delay to pause. **Resume automatically** is off by default. Enable it to resume an assistant-paused video after a confident return.
5. **Try without a camera** sends clearly labelled simulated head positions through the same cross-tab playback path. It does not estimate your face.
6. **Stop assistance** disables camera/simulation and clears automatic-resume ownership. Normal site controls continue working.

Changing tabs, navigating, closing the panel, or losing fresh observations suspends assistance and clears stale resume ownership. Click the toolbar icon again to select/reconnect a tab. Manual pauses and seeking do not instruct automatic resume.

## Site access and privacy

Required permissions: `activeTab`, `scripting`, `sidePanel`, `storage`. No website access is granted at installation. Clicking the toolbar grants temporary access to that selected tab. **Allow this site for reconnects** optionally requests access to that site's origin; granting it is your choice.

Camera access occurs only after Enable camera, with video enabled and microphone disabled. MediaPipe JavaScript, Wasm and model files are packaged locally. Camera frames/landmarks are not stored or uploaded. Preferences stay in local extension storage; selected-target/session state uses session storage. There is no backend or analytics service.

## Compatibility

The adapter targets one visible standard HTML video in the main document. It prefers YouTube's main video container when present and otherwise chooses the largest visible video. Tiny/hidden previews are excluded.

Initial target: Chrome/Edge desktop with MV3 side-panel APIs (Chrome116+). Restricted browser pages, extension-store pages, cross-origin embedded video, closed shadow roots, custom player APIs and site changes may prevent control. The YouTube selector is covered by fixture tests, but live YouTube playback was not verified in this run. Netflix uses the generic HTML video adapter and has not been tested with an authenticated playback account. No DRM is bypassed. Fullscreen/closed panels, background playback and PiP are not guaranteed modes; keep the side panel visible.

Human accuracy needs representative testing across people, lighting, posture, glasses and hardware. Fake-camera tests validate packaged model/runtime initialization and lifecycle behavior rather than real-person accuracy.

## Build and test

From `browser/` with Node22.12+:

```sh
npm ci
npm test
npm run package:extension
npx playwright install chromium
npm run test:extension
```

Unpacked package: `browser/extension-dist/`. ZIP: `browser/artifacts/stillpoint-extension-v0.2.0.zip`. Generated folders are ignored by Git. The ZIP root includes manifest.json, panel/background/content bundles, model, Wasm, icons, notices and installation instructions.

Extension E2E loads the actual package in an isolated persistent Chromium profile, invokes the real toolbar action and drives the actual side panel over CDP. `STILLPOINT_CHROMIUM_EXECUTABLE` can override the executable for local runtime issues. This machine's bundled full Chromium had a Windows SxS launch issue; a byte-for-byte temporary copy was used successfully. Normal CI uses bundled Playwright Chromium. Tests never install into a person's existing browser profile.
