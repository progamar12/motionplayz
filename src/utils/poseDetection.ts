import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseResult {
  landmarks: PoseLandmark[];
  worldLandmarks: PoseLandmark[];
}

// Pose landmark indices from MediaPipe
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export class PoseDetector {
  private pose: Pose;
  private lastResults: PoseResult | null = null;
  private initialized = false;

  constructor() {
    this.pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      },
    });

    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.pose.onResults((results) => {
      if (results.poseLandmarks && results.poseWorldLandmarks) {
        this.lastResults = {
          landmarks: results.poseLandmarks.map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility || 0,
          })),
          worldLandmarks: results.poseWorldLandmarks.map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility || 0,
          })),
        };
      }
      this.initialized = true;
    });
  }

  async initialize(): Promise<void> {
    await this.pose.initialize();
    this.initialized = true;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async detect(image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<PoseResult | null> {
    await this.pose.send({ image });
    return this.lastResults;
  }

  getResults(): PoseResult | null {
    return this.lastResults;
  }

  static drawPose(
    canvas: HTMLCanvasElement,
    landmarks: PoseLandmark[]
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw connections
    drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 2,
    });

    // Draw landmarks
    drawLandmarks(ctx, landmarks, {
      color: '#FF0000',
      lineWidth: 1,
      radius: 3,
    });
  }
}

export function calculateAngle(
  a: PoseLandmark,
  b: PoseLandmark,
  c: PoseLandmark
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * (180 / Math.PI));

  if (angle > 180) {
    angle = 360 - angle;
  }

  return angle;
}

export function normalizeCoordinate(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}
