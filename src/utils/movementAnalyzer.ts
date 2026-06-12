import { PoseResult, POSE_LANDMARKS } from './poseDetection';

export type MovementType =
  | 'jump'
  | 'crouch'
  | 'left'
  | 'right'
  | 'left-arm-raise'
  | 'right-arm-raise'
  | 'arms-up'
  | 'idle';

export interface MovementState {
  type: MovementType;
  confidence: number;
  rawValues: {
    hipY: number;
    shoulderY: number;
    leftWristY: number;
    rightWristY: number;
    noseY: number;
    shoulderWidthX: number;
    centerX: number;
  };
}

export interface MovementThresholds {
  jumpHeightThreshold: number;
  crouchHeightThreshold: number;
  armRaiseThreshold: number;
  lateralMovementThreshold: number;
}

const DEFAULT_THRESHOLDS: MovementThresholds = {
  jumpHeightThreshold: 0.08,
  crouchHeightThreshold: 0.12,
  armRaiseThreshold: 0.2,
  lateralMovementThreshold: 0.15,
};

export class MovementAnalyzer {
  private baseline: {
    hipY: number;
    shoulderY: number;
    noseY: number;
    centerX: number;
    shoulderWidthX: number;
  } | null = null;

  private thresholds: MovementThresholds;
  private recentMovements: MovementType[] = [];
  private smoothingWindow = 5;

  constructor(thresholds: Partial<MovementThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  calibrate(pose: PoseResult): void {
    if (!pose.landmarks) return;

    const landmarks = pose.landmarks;

    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const nose = landmarks[POSE_LANDMARKS.NOSE];

    this.baseline = {
      hipY: (leftHip.y + rightHip.y) / 2,
      shoulderY: (leftShoulder.y + rightShoulder.y) / 2,
      noseY: nose.y,
      centerX: (leftShoulder.x + rightShoulder.x) / 2,
      shoulderWidthX: Math.abs(leftShoulder.x - rightShoulder.x),
    };
  }

  analyze(pose: PoseResult | null): MovementState {
    const idleState: MovementState = {
      type: 'idle',
      confidence: 1,
      rawValues: {
        hipY: 0,
        shoulderY: 0,
        leftWristY: 0,
        rightWristY: 0,
        noseY: 0,
        shoulderWidthX: 0,
        centerX: 0,
      },
    };

    if (!pose || !pose.landmarks || !this.baseline) {
      return idleState;
    }

    const landmarks = pose.landmarks;

    // Extract key landmarks
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const nose = landmarks[POSE_LANDMARKS.NOSE];

    // Check visibility
    const visibleLandmarks = [
      leftHip, rightHip, leftShoulder, rightShoulder,
      leftWrist, rightWrist, nose
    ];
    const avgVisibility = visibleLandmarks.reduce((sum, lm) => sum + (lm?.visibility || 0), 0) / visibleLandmarks.length;

    if (avgVisibility < 0.5) {
      return idleState;
    }

    // Calculate current values
    const currentHipY = (leftHip.y + rightHip.y) / 2;
    const currentShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const currentNoseY = nose.y;
    const currentCenterX = (leftShoulder.x + rightShoulder.x) / 2;
    const currentShoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

    // Vertical movement (Y decreases when going up)
    const hipDeltaY = this.baseline.hipY - currentHipY; // Positive = moved up (jump)
    const shoulderDeltaY = this.baseline.shoulderY - currentShoulderY;

    // Lateral movement
    const centerXDelta = currentCenterX - this.baseline.centerX;
    const normalizedLateralDelta = centerXDelta / this.baseline.shoulderWidthX;

    // Arm positions (wrist relative to shoulder)
    const leftArmRaise = leftShoulder.y - leftWrist.y; // Positive = arm raised
    const rightArmRaise = rightShoulder.y - rightWrist.y; // Positive = arm raised

    const rawValues = {
      hipY: hipDeltaY,
      shoulderY: shoulderDeltaY,
      leftWristY: leftArmRaise,
      rightWristY: rightArmRaise,
      noseY: this.baseline.noseY - currentNoseY,
      shoulderWidthX: currentShoulderWidth,
      centerX: normalizedLateralDelta,
    };

    // Determine movement type
    let movementType: MovementType = 'idle';
    let confidence = 0.5;

    const { jumpHeightThreshold, crouchHeightThreshold, armRaiseThreshold, lateralMovementThreshold } = this.thresholds;

    // Priority: Jump > Crouch > Arms > Lateral
    if (hipDeltaY > jumpHeightThreshold && shoulderDeltaY > jumpHeightThreshold * 0.5) {
      movementType = 'jump';
      confidence = Math.min(hipDeltaY / jumpHeightThreshold, 1);
    } else if (hipDeltaY < -crouchHeightThreshold) {
      movementType = 'crouch';
      confidence = Math.min(Math.abs(hipDeltaY) / crouchHeightThreshold, 1);
    } else if (leftArmRaise > armRaiseThreshold && rightArmRaise > armRaiseThreshold) {
      movementType = 'arms-up';
      confidence = Math.min((leftArmRaise + rightArmRaise) / (2 * armRaiseThreshold), 1);
    } else if (leftArmRaise > armRaiseThreshold) {
      movementType = 'left-arm-raise';
      confidence = Math.min(leftArmRaise / armRaiseThreshold, 1);
    } else if (rightArmRaise > armRaiseThreshold) {
      movementType = 'right-arm-raise';
      confidence = Math.min(rightArmRaise / armRaiseThreshold, 1);
    } else if (normalizedLateralDelta > lateralMovementThreshold) {
      movementType = 'right';
      confidence = Math.min(normalizedLateralDelta / lateralMovementThreshold, 1);
    } else if (normalizedLateralDelta < -lateralMovementThreshold) {
      movementType = 'left';
      confidence = Math.min(Math.abs(normalizedLateralDelta) / lateralMovementThreshold, 1);
    }

    // Smoothing
    this.recentMovements.push(movementType);
    if (this.recentMovements.length > this.smoothingWindow) {
      this.recentMovements.shift();
    }

    const smoothedMovement = this.getMostFrequentMovement();

    return {
      type: smoothedMovement,
      confidence,
      rawValues,
    };
  }

  private getMostFrequentMovement(): MovementType {
    if (this.recentMovements.length === 0) return 'idle';

    const counts: Record<MovementType, number> = {
      'idle': 0,
      'jump': 0,
      'crouch': 0,
      'left': 0,
      'right': 0,
      'left-arm-raise': 0,
      'right-arm-raise': 0,
      'arms-up': 0,
    };

    for (const movement of this.recentMovements) {
      counts[movement]++;
    }

    let maxCount = 0;
    let maxMovement: MovementType = 'idle';

    for (const [movement, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxMovement = movement as MovementType;
      }
    }

    return maxMovement;
  }

  getBaseline(): typeof this.baseline {
    return this.baseline;
  }

  resetBaseline(): void {
    this.baseline = null;
    this.recentMovements = [];
  }
}

export const movementToKeyMap: Record<MovementType, string | null> = {
  'jump': 'Space',
  'crouch': 'ArrowDown',
  'left': 'ArrowLeft',
  'right': 'ArrowRight',
  'left-arm-raise': 'KeyA',
  'right-arm-raise': 'KeyD',
  'arms-up': 'KeyW',
  'idle': null,
};
