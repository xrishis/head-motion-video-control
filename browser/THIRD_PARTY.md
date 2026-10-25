# Third-party software and assets

The application uses npm dependencies with their individual package licenses. `package-lock.json` records the installed versions. Keep the dependency notices when distributing a build.

| Component | Source / license information |
|---|---|
| React and React DOM | https://github.com/facebook/react — MIT |
| Lucide React icons | https://github.com/lucide-icons/lucide — ISC |
| MediaPipe Tasks Vision runtime | https://github.com/google-ai-edge/mediapipe — Apache-2.0, as declared by the installed npm package |
| Face Landmarker model bundle | Google-hosted bundle: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task ; model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker |
| Original sample lesson and vector poster | Created for this project with code. See `public/demo/README.md`. No third-party video/audio footage. |
| UI concept | Generated for this project using the built-in Image Gen tool; retained in `docs/design/`. |

The two `public/mediapipe/vision_wasm_module_internal.*` files are copied from the installed `@mediapipe/tasks-vision` package. They must stay in sync with its JavaScript version. Model/runtime hosting is local to the app's deployed origin; no inference service receives learner camera data.

Copies of the React, React DOM, Lucide, and MediaPipe license texts are included in `public/licenses/` and shipped with the static build. The React/React DOM/Lucide texts are copied from the installed packages; the MediaPipe Apache-2.0 text is copied from its upstream repository.

The original repository's empty Python `src/LICENSE` does not define a project-wide distribution license. This MVP does not add an open-source license for the author's own code. Establish the intended commercial licensing and verify the model/dependency distribution terms before selling or redistributing the product.
