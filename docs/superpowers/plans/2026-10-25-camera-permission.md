# Camera permission popup implementation plan

> **For agentic workers:** Use subagent-driven-development to implement the permission helper while the parent integrates and verifies the panel.

**Goal:** Clicking Enable camera opens the browser's native camera permission request automatically and continues in the side panel after consent.

**Architecture:** Chromium side panels cannot display the initial media permission prompt. A focused packaged extension popup requests video-only getUserMedia, stops its temporary stream, and sends a correlated, authenticated success message to the requesting panel. The panel starts tracking only if the same selected session is still connected, the request was not cancelled, and the panel is visible.

**Tech stack:** Existing MV3 extension, TypeScript, React, Vite, Vitest and actual packaged Chromium tests.

**Spec:** User's 2026-10-25 screenshot and request for an automatic permission popup; existing browser-extension-design.md.

## Constraints and review focus

- Native consent remains required; an explicit browser/OS block cannot be bypassed or forcibly re-prompted.
- Request camera only, never microphone. Stop the permission window's tracks before tracking begins.
- No installation-wide website grants, remote code, extra manifest permissions, or changes to pause ownership.
- Cancel, window close, selected-tab changes, component unmount and late asynchronous results must never start a camera.
- Authenticate the packaged sender and random request ID; do not accept page/content-script messages as consent.
- Keep blocked/no-device/in-use errors actionable in the popup; offer retry and cancellation.

## Tasks

- [x] Reproduce first-time side-panel failure without fake media-permission UI; compare a top-level extension page.
- [x] Add a failing packaged-browser regression for automatic popup and cancellation.
- [x] Add helper regression tests for successful consent, spoofed messages, cancellation, delayed creation and cleanup; implement helper and permission page.
- [x] Integrate pending permission state, cancellation and selected-session guards in PanelApp; add Vite page entry.
- [x] Verify first-time prompt, grant-to-tracking, denied recovery, previously granted startup and existing playback behavior using isolated synthetic camera profiles.
- [x] Review changes, bump extension to 0.2.1, update download links/instructions, run unit/browser/build/package checks.
- [ ] Publish source and release ZIP to the already authorized xrishis repository; verify public asset and deployment.

## Evidence ledger

- Root cause: direct getUserMedia in PanelApp's side-panel document; Chromium extension platform discussion confirms side panels cannot show permission prompts and recommends a focused popup window.
- Existing fake-ui-for-media-stream tests bypassed that permission boundary. New regressions remove that flag for the first-time request path.
- Ruling: reuse the current clean codex/browser-extension checkout. Publishing is already authorized by the user and previous release workflow.
- First-time popup regression failed against 0.2.0 because no permission window opened. Reload regression failed with the first implementation because the pending popup survived panel destruction; pagehide/beforeunload abort fixes that boundary.
- Verification: 141 unit tests, 18 standalone browser tests and 11 packaged extension tests passed. A separate headed fake-device-only test confirmed `Permissions.Prompt.VideoCapture.ShownInActiveBrowser` count above zero for the actual helper page, then cancelled it. No real webcam was used.
- Browser plugin not available; used the repository's Playwright workflow. Inspected the permission-page screenshot: meaningful content, readable controls, no framework overlay or horizontal overflow. A fresh reviewer found no remaining actionable issue after the unload fix.
- Native prompt discussion: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/cJmdMLmpbjg/m/vTqZxqATCQAJ
- Release package: 25 files, 7,014,840 bytes; SHA-256 `a89296239e3dd639f455b65aab5fd69751166ac42817188927e207749917c92b`. Publishing follows the verified commit; public outcome is recorded in the GitHub release and Actions run.
- Linux CI exposed an existing reload-test readiness race: Page.reload acknowledged before navigation, and `!missingElement?.disabled` incorrectly meant ready. The tests now wait for the main frame's loader ID to change and require an existing enabled button. Both reload regressions passed three repetitions each locally; a reviewer confirmed the test change. Runtime/package contents are unchanged.
