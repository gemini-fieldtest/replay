import { useState, useEffect, useRef } from "react";
import type { TelemetryFrame } from "../utils/telemetryParser";

export interface DrivingAnalysis {
  phase: "Entry" | "Apex" | "Exit" | "Straight" | null;
  gripUsage: number; // Combined G
  tireUsagePct: number; // % of Max G
  tireStatus:
    | "COLD_OR_CRUISING"
    | "UNDER_DRIVING"
    | "AT_LIMIT"
    | "OVER_DRIVING";
  smoothnessScore: number; // 0-100 (100 = smoothest)
  isSteeringChoppy: boolean;
  isPedalChoppy: boolean;
  rpmBand: "Low" | "Power" | "Over-rev" | null;
  gradient?: number;
  isCoasting?: boolean;
  isPanicBraking?: boolean;
  safetyFlags: string[];
}

export function useDrivingAnalysis(
  currentFrame: TelemetryFrame | null
): DrivingAnalysis {
  const historyRef = useRef<TelemetryFrame[]>([]);
  const ANALYSIS_WINDOW_SIZE = 60; // Increased to 1s (60 frames) to support longer coasting checks

  // Initial state
  const [analysis, setAnalysis] = useState<DrivingAnalysis>({
    phase: null,
    gripUsage: 0,
    tireUsagePct: 0,
    tireStatus: "COLD_OR_CRUISING",
    smoothnessScore: 100,
    isSteeringChoppy: false,
    isPedalChoppy: false,
    rpmBand: null,
    safetyFlags: [],
  });

  useEffect(() => {
    if (!currentFrame) return;

    // Maintain history buffer in ref (side effect safe in useEffect)
    historyRef.current.push(currentFrame);
    if (historyRef.current.length > ANALYSIS_WINDOW_SIZE) {
      historyRef.current.shift();
    }

    // Perform analysis based on current frame and history
    const history = historyRef.current; // Safe to read ref here

    // 1. Grip Usage (Combo G)
    const latG = currentFrame.gForceLat || 0;
    const longG = currentFrame.gForceLong || 0;
    const comboG = Math.sqrt(latG * latG + longG * longG);

    // 2. Cornering Phase Detection
    let phase: "Entry" | "Apex" | "Exit" | "Straight" | null = "Straight";
    const isTurning = Math.abs(latG) > 0.3; // Threshold for defining a "corner" in data

    if (isTurning) {
      // Check trend in speed over last few frames
      const recentFrames = history.slice(-10);
      const speedStart = recentFrames[0]?.speed || 0;
      const speedEnd = currentFrame.speed;
      const speedDelta = speedEnd - speedStart;

      if (currentFrame.brake > 5 && speedDelta < -0.5) {
        phase = "Entry";
      } else if (currentFrame.throttle > 5 && speedDelta > 0.5) {
        phase = "Exit";
      } else {
        // If not clearly accelerating or braking, it's the mid-corner/apex phase
        // Often minimal inputs, max Lateral G
        phase = "Apex";
      }
    } else {
      phase = "Straight";
    }

    // 3. Smoothness Scoring
    // Calculate variance/derivative of inputs
    let steeringNoise = 0;
    let pedalNoise = 0;

    if (history.length > 5) {
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];

        steeringNoise += Math.abs(curr.steering - prev.steering);
        // Combine throttle and brake noise
        pedalNoise +=
          Math.abs(curr.throttle - prev.throttle) +
          Math.abs(curr.brake - prev.brake);
      }
    }

    // Normalize scores (heuristics based on typical values)
    // High noise = low score
    const isSteeringChoppy = steeringNoise > 15; // > 15 degrees cumulative change in 0.5s
    const isPedalChoppy = pedalNoise > 20; // > 20% cumulative change in 0.5s

    // Simple 0-100 score mapping (inverse of noise)
    const rawScore = 100 - (steeringNoise + pedalNoise);
    const smoothnessScore = Math.max(0, Math.min(100, rawScore));

    // 4. Engine Band
    let rpmBand: "Low" | "Power" | "Over-rev" | null = "Power";
    // Assume typical logic: < 3000 Low, > 7000 Over (generic race car)
    // Ideally this would be car specific config
    if (currentFrame.rpm < 3000) rpmBand = "Low";
    else if (currentFrame.rpm > 7200) rpmBand = "Over-rev";
    else rpmBand = "Power";

    // RaceMath Logic
    const MAX_TIRE_G = 1.3; // Configurable? Default to sticky tires

    // 1. Friction Circle (Tire Usage) - Updated Logic
    // Python: usage_pct = total_g / max_tire_g
    const tireUsagePct = Math.min(comboG / MAX_TIRE_G, 1.2) * 100; // Cap at 120% for sanity

    let tireStatus:
      | "COLD_OR_CRUISING"
      | "UNDER_DRIVING"
      | "AT_LIMIT"
      | "OVER_DRIVING" = "COLD_OR_CRUISING";
    const usageRatio = comboG / MAX_TIRE_G;

    if (usageRatio < 0.6) tireStatus = "COLD_OR_CRUISING";
    else if (usageRatio < 0.85) tireStatus = "UNDER_DRIVING";
    else if (usageRatio <= 1.05) tireStatus = "AT_LIMIT";
    else tireStatus = "OVER_DRIVING";

    // 2. Cornering Phase (Existing logic preserved, it works well)
    // ... (Skipping re-implementation of phase logic if it's fine, but verifying it matches context)
    // Actually, let's keep the existing phase logic as it adds value (Entry/Exit) which RaceMath didn't explicitly replace.

    // 5. Advanced Flags (Updated to match Python Rules)
    const safetyFlags: string[] = [];

    // RULE 1: COASTING
    // Modification: Check last 45 frames (~0.75s) to confirm sustained coasting.
    // AND restrict to CORNERS (Lat G > 0.4). Coasting on a straight is allowed (cooling/saving fuel).
    let isCoasting = false;
    // Only check if moving fast AND turning significant Gs
    if (currentFrame.speed > 30 && Math.abs(currentFrame.gForceLat) > 0.4) {
      const COASTING_WINDOW = 45; // ~0.75 seconds
      const recent = history.slice(-COASTING_WINDOW);

      // Must have enough data AND all recent frames must be coasting
      if (recent.length >= COASTING_WINDOW) {
        const sustainedCoasting = recent.every(
          (f) => f.throttle < 5 && f.brake < 5
        );
        if (sustainedCoasting) {
          isCoasting = true;
          safetyFlags.push("COASTING_DETECTED");
        }
      }
    }

    // RULE 2: PANIC BRAKE
    // Python: Brake Jerk > 80 (0->80% in 1 frame?) AND Steer > 15
    let isPanicBraking = false;
    if (history.length > 1) {
      const prevFrame = history[history.length - 2]; // Immediate previous frame
      const brakeJerk = currentFrame.brake - prevFrame.brake;

      // Check if we went from low brake to high brake instantly?
      // Python logic: brake - prev_brake > 80.
      if (brakeJerk > 80 && Math.abs(currentFrame.steering) > 15) {
        isPanicBraking = true;
        safetyFlags.push("PANIC_BRAKE_IN_TURN");
      }
    }

    setAnalysis({
      phase,
      gripUsage: Number(comboG.toFixed(2)),
      tireUsagePct: Number(tireUsagePct.toFixed(1)),
      tireStatus,
      smoothnessScore: Math.round(smoothnessScore),
      isSteeringChoppy,
      isPedalChoppy,
      rpmBand,
      gradient: currentFrame.gradient,
      isCoasting,
      isPanicBraking,
      safetyFlags,
    });
  }, [currentFrame]);

  return analysis;
}
