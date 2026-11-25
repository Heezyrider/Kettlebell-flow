/**
 * Camera + MediaPipe PoseLandmarker wrapper.
 * Owns the <video>, the skeleton <canvas> and the per-frame detection loop.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { LM, MIN_VISIBILITY, type Landmark } from './exercises';

const WASM_URL = `${import.meta.env.BASE_URL}mediapipe-wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

const BONES: [number, number][] = [
  [LM.lShoulder, LM.rShoulder],
  [LM.lShoulder, LM.lElbow],
  [LM.lElbow, LM.lWrist],
  [LM.rShoulder, LM.rElbow],
  [LM.rElbow, LM.rWrist],
  [LM.lShoulder, LM.lHip],
  [LM.rShoulder, LM.rHip],
  [LM.lHip, LM.rHip],
  [LM.lHip, LM.lKnee],
  [LM.lKnee, LM.lAnkle],
  [LM.rHip, LM.rKnee],
  [LM.rKnee, LM.rAnkle],
];
const JOINTS = [...new Set(BONES.flat()), LM.nose];

export type FrameHandler = (lm: Landmark[] | null, aspect: number, timeMs: number) => void;

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private ctx: CanvasRenderingContext2D | null;
  /** Detection runs only while this is true; the camera preview keeps playing. */
  detecting = false;
  onFrame: FrameHandler = () => {};
  fps = 0;
  /** Skeleton colour; the workout sets it from the tracking state of the current exercise. */
  skeletonColor = '#9aa4b2';
  delegate: 'GPU' | 'CPU' | null = null;

  constructor(
    readonly video: HTMLVideoElement,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('2d');
  }

  get modelReady(): boolean {
    return this.landmarker !== null;
  }

  get cameraReady(): boolean {
    return this.stream !== null;
  }

  async startCamera(facing: 'user' | 'environment'): Promise<void> {
    this.stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not available (HTTPS is required).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Loads the lite pose model, preferring the GPU delegate. */
  async loadModel(): Promise<void> {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await create('GPU');
      this.delegate = 'GPU';
    } catch {
      this.landmarker = await create('CPU');
      this.delegate = 'CPU';
    }
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    let frames = 0;
    let fpsSince = performance.now();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      const v = this.video;
      if (!this.detecting || !this.landmarker || v.readyState < 2 || !v.videoWidth) return;
      if (v.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      let lm: Landmark[] | null = null;
      try {
        lm = this.landmarker.detectForVideo(v, now).landmarks[0] ?? null;
      } catch {
        return;
      }
      frames++;
      if (now - fpsSince >= 1000) {
        this.fps = Math.round((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
      }
      this.onFrame(lm, v.videoWidth / v.videoHeight, now);
      this.draw(lm);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.clearCanvas();
  }

  dispose(): void {
    this.stop();
    this.stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
  }

  clearCanvas(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(lm: Landmark[] | null): void {
    const { canvas, ctx, video } = this;
    if (!ctx) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const w = canvas.width;
    const hgt = canvas.height;
    ctx.clearRect(0, 0, w, hgt);
    if (!lm) return;
    const seen = (i: number): boolean => (lm[i]?.visibility ?? 0) >= MIN_VISIBILITY;
    const unit = Math.max(w, hgt) / 100;
    ctx.lineCap = 'round';
    ctx.lineWidth = unit * 0.9;
    ctx.strokeStyle = this.skeletonColor;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if (!seen(a) || !seen(b)) continue;
      ctx.moveTo(lm[a].x * w, lm[a].y * hgt);
      ctx.lineTo(lm[b].x * w, lm[b].y * hgt);
    }
    ctx.stroke();
    ctx.fillStyle = '#f2f4f7';
    for (const i of JOINTS) {
      if (!seen(i)) continue;
      ctx.beginPath();
      ctx.arc(lm[i].x * w, lm[i].y * hgt, unit * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Keeps the screen on; re-acquires the lock when the tab becomes visible again. */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private onVisible = (): void => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  async enable(): Promise<void> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    await this.acquire();
  }

  disable(): void {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }

  private async acquire(): Promise<void> {
    try {
      this.sentinel = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      /* not supported or denied: nothing we can do */
    }
  }
}
