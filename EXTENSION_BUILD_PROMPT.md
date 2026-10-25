# Extension build prompt

Act as a senior browser, automation and backend engineer. Convert the existing Stillpoint browser MVP into an actually downloadable and tested Chrome/Edge extension. Execute the plan instead of stopping at recommendations.

Read the extension design and plan under docs/superpowers before coding. Reuse current React design, pose/calibration math, local worker/model assets and pause-ownership policy. Build Manifest V3 side panel + service-worker router + injected standard-video controller. Use explicit selected-tab/site permission, video-only camera consent, strict messages/session tokens and capture-age checks. Preserve manual pauses, reject stale or late actions, clean up all resources, and provide honest no-video/unsupported-site feedback.

Write failing behavior tests before complex implementation. Build and load the actual extension in isolated Chromium with a persistent context. Test cross-tab video control and actual model initialization under extension CSP; do not count a mocked extension API as end-to-end proof. Preserve the existing website and Python app.

Deliver a versioned ZIP with manifest.json at its root and all local assets/notices. Document extract + Load unpacked installation, side panel/camera requirements and compatibility limits. Publish to the existing xrishis/head-motion-video-control repository and GitHub Release after checks pass, add a real download link to the demo, and verify the download. Do not claim Chrome Web Store publication, universal site compatibility, Netflix account testing or human tracking accuracy without the corresponding evidence.
