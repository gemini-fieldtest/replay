import { useState, useEffect, useRef, useMemo } from 'react';
import type { TelemetryFrame } from '../utils/telemetryParser';

export interface DrivingAnalysis {
  phase: 'Entry' | 'Apex' | 'Exit' | 'Straight' | null;
  gripUsage: number; // Combined G
  smoothnessScore: number; // 0-100 (100 = smoothest)
  isSteeringChoppy: boolean;
  isPedalChoppy: boolean;
  rpmBand: 'Low' | 'Power' | 'Over-rev' | null;
  gradient?: number;
}

export function useDrivingAnalysis(currentFrame: TelemetryFrame | null): DrivingAnalysis {
    const historyRef = useRef<TelemetryFrame[]>([]);
    const ANALYSIS_WINDOW_SIZE = 30; // ~0.5 seconds at 60Hz
    
    // Initial state
    const [analysis, setAnalysis] = useState<DrivingAnalysis>({
        phase: null,
        gripUsage: 0,
        smoothnessScore: 100,
        isSteeringChoppy: false,
        isPedalChoppy: false,
        rpmBand: null
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
        let phase: 'Entry' | 'Apex' | 'Exit' | 'Straight' | null = 'Straight';
        const isTurning = Math.abs(latG) > 0.3; // Threshold for defining a "corner" in data
        
        if (isTurning) {
            // Check trend in speed over last few frames
            const recentFrames = history.slice(-10);
            const speedStart = recentFrames[0]?.speed || 0;
            const speedEnd = currentFrame.speed;
            const speedDelta = speedEnd - speedStart;

            if (currentFrame.brake > 5 && speedDelta < -0.5) {
                phase = 'Entry';
            } else if (currentFrame.throttle > 5 && speedDelta > 0.5) {
                phase = 'Exit';
            } else {
                // If not clearly accelerating or braking, it's the mid-corner/apex phase
                // Often minimal inputs, max Lateral G
                phase = 'Apex';
            }
        } else {
            phase = 'Straight';
        }

        // 3. Smoothness Scoring
        // Calculate variance/derivative of inputs
        let steeringNoise = 0;
        let pedalNoise = 0;
        
        if (history.length > 5) {
            for (let i = 1; i < history.length; i++) {
                const prev = history[i-1];
                const curr = history[i];
                
                steeringNoise += Math.abs(curr.steering - prev.steering);
                // Combine throttle and brake noise
                pedalNoise += Math.abs(curr.throttle - prev.throttle) + Math.abs(curr.brake - prev.brake);
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
        let rpmBand: 'Low' | 'Power' | 'Over-rev' | null = 'Power';
        // Assume typical logic: < 3000 Low, > 7000 Over (generic race car)
        // Ideally this would be car specific config
        if (currentFrame.rpm < 3000) rpmBand = 'Low';
        else if (currentFrame.rpm > 7200) rpmBand = 'Over-rev';
        else rpmBand = 'Power';

        setAnalysis({
            phase,
            gripUsage: Number(comboG.toFixed(2)),
            smoothnessScore: Math.round(smoothnessScore),
            isSteeringChoppy,
            isPedalChoppy,
            rpmBand,
            gradient: currentFrame.gradient
        });

    }, [currentFrame]);

    return analysis;
}
