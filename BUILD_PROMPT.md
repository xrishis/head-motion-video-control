# Browser MVP execution prompt

Act as a senior product engineer with the judgment of an experienced Python, automation, and backend developer. Build and verify this product, rather than stopping at advice. Use the simplest architecture that satisfies the requirements.

## Objective

Turn this project's head-motion experiment into a working browser demo for training companies. The deliverable is an optional, learner-controlled video playback assistant with camera processing on the learner's device.

## Constraints

- Preserve the existing Python application. Put the new application in `browser/`.
- The enclosing Git repository belongs to the user's home directory. Do not stage, commit, branch, or create worktrees against that unrelated repository.
- Use React, TypeScript, Vite, and MediaPipe Face Landmarker. No backend, login, billing, or camera uploads are needed.
- Request the camera only after the learner explicitly enables it. Request video only, never microphone access.
- Bundle model and runtime assets locally. No third-party analytics, remote fonts, or camera/landmark telemetry.
- Support desktop Chrome first; keep the UI responsive and keyboard accessible.
- The user also authorized GitHub publication to `xrishis`. Verify the active account, create/use a dedicated project repository, and configure GitHub Pages only after local checks pass. Never publish the enclosing home-directory repository.
- Provide a clearly labelled simulation mode that works without camera permission. Simulation must drive the same playback policy as real tracking and must never masquerade as measured camera accuracy.

## Required behavior

1. Include a playable sample video and allow a learner to choose a local video file without uploading it.
2. Calibrate a neutral head orientation from stable face observations. Explain positioning and progress clearly.
3. Distinguish facing forward, turned away, absent face, and unknown tracking. Estimate orientation from facial transformation matrices, not the original eye-to-nose image-plane angle.
4. Use configurable pause and return delays, separate thresholds for leaving/returning, and confidence handling to avoid flicker.
5. Pause only when appropriate after a sustained turn or absence. Never interpret tracking failure as facing forward.
6. Automatic resume is optional and off by default. Resume only a lesson paused by the assistant, after a confident return and without a later learner override.
7. Preserve manual pause, manual play, seeking/navigation, source changes, and ended media. Clear stale assistant ownership on lesson changes, failures, or disable.
8. Provide enable/disable, recalibrate, snooze, camera status, actionable errors, and normal playback controls. Stop camera tracks on disable/unmount.
9. Run bounded camera inference in a worker; drop stale frames rather than building an unbounded queue. Handle camera denial, disconnection, missing model, inference stall, hidden tabs, and rejected playback requests.
10. Explain precisely that camera processing stays on device; ordinary asset downloads still use the network.

## Execute in this order

1. Record the agreed scope, architecture, and acceptance criteria in a short design and implementation plan.
2. Create a coherent visual concept and derive restrained UI tokens and layout from it.
3. Scaffold the browser package and install only the dependencies required by the MVP.
4. Write failing behavioral tests for the playback state machine and pose/calibration mathematics; then implement those modules.
5. Build the real player UI, local-video input, settings, and simulation flow. Test the first useful interaction before broadening the interface.
6. Integrate real camera capture, worker inference, calibration, and lifecycle/error handling.
7. Run unit tests, TypeScript checks, a production build, and automated browser tests. Verify desktop and mobile layouts and inspect screenshots.
8. Review lifecycle races, manual playback ownership, privacy claims, and camera cleanup. Fix concrete findings and rerun affected checks.
9. Start a local demo server, open the working app, and report the URL, commands, verification results, and untested real-world conditions.
10. Publish the verified project to `xrishis/head-motion-video-control`, configure the supplied GitHub Pages workflow, wait for successful CI/deployment, and verify playback and local tracking assets at the public project URL.

## Definition of done

- A working local browser URL is available and the sample video plays.
- Simulation demonstrates delayed pause, optional resume, manual-pause preservation, and reset on source changes.
- The real camera path loads local MediaPipe assets and produces calibrated orientation observations; denial and tracking failures leave manual controls usable.
- All automated tests, type checks, and production build pass.
- Browser checks exercise the real rendered app and include responsive screenshots.
- README documents setup, controls, architecture, asset provenance, limitations, and next integration work.
- Report tests honestly. Synthetic-camera checks do not prove accuracy on a person's face, and a localhost demo is not a public deployment.

Proceed through these steps autonomously within the authorized scope. Do not claim the product is ready for a company pilot until it has been validated with representative users and the target player.
