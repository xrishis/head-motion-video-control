import type { FaceLandmarker } from '@mediapipe/tasks-vision'

type InitMessage = {
  type: 'init'
  wasmBase: string
  modelUrl: string
}

type FrameMessage = {
  type: 'frame'
  bitmap: ImageBitmap
  timestamp: number
}

type WorkerMessage = InitMessage | FrameMessage

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; timestamp: number; faceCount: number; matrix: number[] | null }
  | { type: 'error'; message: string }

// The application uses DOM types; avoid adding conflicting WebWorker globals.
type TrackerWorkerScope = {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

const worker = self as unknown as TrackerWorkerScope
let landmarker: FaceLandmarker | null = null
let initializing = false

function reportError(error: unknown): void {
  worker.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
}

async function initialize(message: InitMessage): Promise<void> {
  if (landmarker) {
    worker.postMessage({ type: 'ready' })
    return
  }
  if (initializing) {
    reportError(new Error('Face tracking is already initializing.'))
    return
  }

  initializing = true
  try {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('This browser does not support face tracking in a worker.')
    }

    // Import only after Start. Model and Wasm loading happen within this worker.
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(message.wasmBase, true)
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: message.modelUrl,
        delegate: 'CPU',
      },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      numFaces: 2,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    })
    worker.postMessage({ type: 'ready' })
  } catch (error) {
    reportError(error)
  } finally {
    initializing = false
  }
}

function processFrame({ bitmap, timestamp }: FrameMessage): void {
  try {
    if (!landmarker) {
      throw new Error('Face tracking is not ready.')
    }
    if (!Number.isFinite(timestamp)) {
      throw new Error('The camera frame timestamp is invalid.')
    }

    // Inference is synchronous. The sender allows one frame in flight, and this
    // worker never buffers frames or keeps landmarks after this call returns.
    const result = landmarker.detectForVideo(bitmap, timestamp)
    const faceCount = result.faceLandmarks.length
    const transformation = faceCount === 1 ? result.facialTransformationMatrixes[0] : undefined

    worker.postMessage({
      type: 'result',
      timestamp,
      faceCount,
      matrix: transformation ? Array.from(transformation.data) : null,
    })
  } catch (error) {
    reportError(error)
  } finally {
    // Ownership transfers from the main thread; release even on early errors.
    bitmap.close()
  }
}

worker.onmessage = ({ data }) => {
  if (data.type === 'init') {
    void initialize(data)
    return
  }
  processFrame(data)
}
