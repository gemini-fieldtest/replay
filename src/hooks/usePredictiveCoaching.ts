import { useMemo, useState } from 'react';
import type { LapData } from '../utils/lapAnalysis';
import type { TelemetryFrame } from '../utils/telemetryParser';

import type { TrackPoint } from './useTrackLocation';

export interface MistakeZone {
    startDist: number;
    endDist: number;
    avgSpeedDelta: number;
    type: 'speed_loss' | 'bad_line' | 'coasting' | 'overshoot';
    severity: number; // 0-1
    advice: string;
    lapIndex: number; // Which lap this mistake is from (most recent?)
    locationName?: string; // e.g., "Turn 1"
    specificAdvice?: string; // New field for track-specific advice
}

interface UsePredictiveCoachingProps {
    laps: LapData[];
    currentFrame: TelemetryFrame | null;
    idealLap: LapData | null;
    isEnabled: boolean;
    trackPoints?: TrackPoint[];
}

export const usePredictiveCoaching = ({ laps, currentFrame, idealLap, isEnabled, trackPoints = [] }: UsePredictiveCoachingProps) => {
    const [lastTriggeredZone, setLastTriggeredZone] = useState<number>(-1); // ID/StartDist of last triggered zone

    // 1. Analyze Past Laps to identify Mistake Zones
    const mistakeZones = useMemo(() => {
        if (!isEnabled || laps.length < 1 || !idealLap) return [];

        const zones: MistakeZone[] = [];

        // We really want to know if the USER is consistently making a mistake, 
        // OR if they made a mistake on the VERY LAST lap.
        // Let's focus on the LAST VALID LAP for now to give "Correction" advice.
        // if (!lastLap.isComplete) return []; // Need a complete previous lap?
        // Actually, current lap is usually 'in progress'. 
        // If 'laps' contains ONLY completed laps, then laps[last] is the previous lap.
        // If 'laps' includes current incomplete lap, we need to filter.

        const referenceLap = laps.filter(l => l.isComplete).pop();
        if (!referenceLap) return [];

        // Compare Reference Lap to Ideal Lap
        // We assume both are somewhat aligned or we align them by distance
        // Ideal Lap is usually resampled. We need to align Reference Lap frames to Ideal Lap frames by position?
        // Or just iterate Reference Lap and find nearest Ideal Frame.

        // Simple approach: Iterate Reference Lap frames
        let recordingMistake = false;
        let currentMistake: Partial<MistakeZone> | null = null;
        let runningDeltaSum = 0;
        let mistakeFrameCount = 0;

        // Pre-calculate cumulative distance for reference lap if needed
        // Assuming frames are time-ordered.
        let cumDist = 0;

        for (let i = 0; i < referenceLap.frames.length - 1; i++) {
            const frame = referenceLap.frames[i];
            const nextFrame = referenceLap.frames[i + 1];
            // Calculate distance step
            const distStep = calcDistance(frame, nextFrame);
            cumDist += distStep;

            // Find matching frame in Ideal Lap (by distance)
            // Ideal Lap is likely resampled to 5m.
            // approx index = cumDist / 5
            const idealIndex = Math.floor(cumDist / 5);
            const idealFrame = idealLap.frames[idealIndex];

            if (!idealFrame) continue;

            const speedDelta = frame.speed - idealFrame.speed; // Negative = Slower

            // Thresholds
            const SPEED_LOSS_THRESHOLD = -15; // 15 km/h slower

            if (speedDelta < SPEED_LOSS_THRESHOLD) {
                if (!recordingMistake) {
                    recordingMistake = true;
                    currentMistake = {
                        startDist: cumDist,
                        type: 'speed_loss',
                        lapIndex: referenceLap.lapIndex,
                        advice: "You lost significant speed here last lap."
                    };
                    runningDeltaSum = speedDelta;
                    mistakeFrameCount = 1;
                } else {
                    runningDeltaSum += speedDelta;
                    mistakeFrameCount++;
                }
            } else {
                if (recordingMistake && currentMistake) {
                    // End Mistake Zone
                    recordingMistake = false;
                    currentMistake.endDist = cumDist;
                    currentMistake.avgSpeedDelta = runningDeltaSum / mistakeFrameCount;
                    currentMistake.severity = Math.min(Math.abs(currentMistake.avgSpeedDelta!) / 30, 1);

                    // Filter: Only significant zones (> 20 meters long?)
                    if ((currentMistake.endDist! - currentMistake.startDist!) > 20) {
                        const zone = currentMistake as MistakeZone;
                        // Find frame index for start of mistake (approximate logic since we iterated)
                        // We started recording when `recordingMistake` became true.
                        // We need to track the index where it started. 
                        // Let's modify the recording loop to capture `startIndex`.
                        // But since we can't easily jump back, let's use the stored distance to search or just enhance the loop.
                        // Actually, adding `startIndex` to MistakeZone is better.
                        zones.push(zone);
                    }
                    currentMistake = null;
                }
            }
        }

        // Post-process zones to map to Track Points
        return zones.map(zone => {
            if (!trackPoints || trackPoints.length === 0) return zone;

            // We need to find the lat/lon of the zone start.
            // StartDist is known.
            // Find frame in Reference Lap at StartDist.
            let d = 0;
            let startFrame = referenceLap.frames[0];

            for (let i = 0; i < referenceLap.frames.length - 1; i++) {
                d += calcDistance(referenceLap.frames[i], referenceLap.frames[i + 1]);
                if (d >= zone.startDist) {
                    startFrame = referenceLap.frames[i];
                    break;
                }
            }

            // Find nearest Track Point
            let bestPoint: TrackPoint | null = null;
            let minDist = Infinity;

            for (const p of trackPoints) {
                const dist = calcDistance(startFrame, { latitude: p.lat, longitude: p.long });
                if (dist < minDist) {
                    minDist = dist;
                    bestPoint = p;
                }
            }

            if (bestPoint && minDist < 150) { // Within 150m of a turn point
                // Format name
                let name = bestPoint.name;
                if (!isNaN(parseInt(name))) {
                    name = `Turn ${name}`;
                }

                // --- NEW LOGIC START ---
                // If the user is losing speed at a known point, use the specific advice!
                let specificAdvice = bestPoint.advice; // Directly use advice from TrackPoint

                return { ...zone, locationName: name, specificAdvice };
                // --- NEW LOGIC END ---
            }

            return zone;
        });

    }, [laps, idealLap, isEnabled, trackPoints]);

    // 2. Realtime Check
    const getAdvice = () => {
        if (!isEnabled || !currentFrame || mistakeZones.length === 0 || !laps.length) return null;

        // Calculate Current Lap Distance
        // This is tricky without 'lapDistance' in TelemetryFrame.
        // We try to approximate it.
        // Find current lap start time.
        // Assuming 'laps' contains completed laps. 
        // If we are in 'current' lap, it's not in 'laps' (completed) usually?
        // Wait, PerformanceCoach receives 'laps' which might include 'current' if incomplete?
        // Let's assume we can map currentFrame time to a lap in 'laps'.

        // Actually, for PREDICTIVE, we need to know where we are on the track MAP (distance from start).
        // If we have 'idealLap', we can simply find the nearest frame in 'idealLap' to 'currentFrame' (by Lat/Lon)
        // and use that frame's cumulative distance.
        // This is robust against driving lines.

        if (!idealLap) return null;

        // Find nearest point in Ideal Lap
        // Optimization: Use a searching window based on previous known position?
        // For now: Brute force or coarse grid search (IdeaLap is sorted by distance).
        // Actually, IdealLap frames are ordered.

        // Let's use a simple nearest neighbor search
        // To be fast, we can sample.

        let minMsgDist = Infinity;
        let matchedDist = -1;

        // Optimization: Checking 1000s of points is slow.
        // Maybe we just trust the 'index' if currentFrame is part of a sequence?
        // No, currentFrame is just one frame.

        // FAST FIND:
        // Ideal Check
        for (let i = 0; i < idealLap.frames.length; i += 10) { // Check every 50m (5m * 10)
            const idFrame = idealLap.frames[i];
            const d = calcDistSq(currentFrame, idFrame);
            if (d < minMsgDist) {
                minMsgDist = d;
                matchedDist = i * 5; // Assuming 5m steps in ideal lap
            }
        }
        // Refine
        // ... (Skipped for performance, coarse is fine for trigger 50m away)

        if (matchedDist === -1) return null;

        const currentDist = matchedDist;
        const speed = Math.max(currentFrame.speed, 50); // Min 50km/h for CALC
        // Increase lookahead to account for AI generation latency (1-4s) + user reaction time (3-4s)
        const lookaheadSeconds = 8;
        const lookaheadMeters = (speed / 3.6) * lookaheadSeconds;

        const targetDist = currentDist + lookaheadMeters;

        // Check Zones
        // We look for a zone that STARTS near targetDist
        // Tolerance: +/- 20m

        const upcomingMistake = mistakeZones.find(z => {
            return (z.startDist >= targetDist - 30 && z.startDist <= targetDist + 30);
        });

        if (upcomingMistake) {
            // Check cooldown
            if (upcomingMistake.startDist !== lastTriggeredZone) {
                setLastTriggeredZone(upcomingMistake.startDist);
                return {
                    text: `Heads up: You lost ${Math.abs(upcomingMistake.avgSpeedDelta).toFixed(0)} km/h here last lap. ${getAdviceText(upcomingMistake)}`,
                    type: 'info' as const
                };
            }
        } else {
            // Reset trigger if we are far past it? 
            // Or just let it reset when we find a new one.
            // Unique ID is StartDist.
        }

        return null;
    };

    return { getAdvice, mistakeZones };
};

// Helpers
function calcDistance(f1: { latitude: number, longitude: number }, f2: { latitude: number, longitude: number }) {
    const R = 6371e3;
    const dLat = (f2.latitude - f1.latitude) * Math.PI / 180;
    const dLon = (f2.longitude - f1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(f1.latitude * Math.PI / 180) * Math.cos(f2.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calcDistSq(f1: { latitude: number, longitude: number }, f2: { latitude: number, longitude: number }) {
    // Approx Euclidean for speed
    const dx = f1.latitude - f2.latitude;
    const dy = f1.longitude - f2.longitude;
    return dx * dx + dy * dy;
}

function getAdviceText(zone: MistakeZone): string {
    const prefix = zone.locationName ? `At ${zone.locationName}: ` : "";

    // --- NEW LOGIC ---
    if (zone.specificAdvice) {
        return `${prefix}${zone.specificAdvice}`;
    }
    // --- END NEW LOGIC ---

    if (zone.type === 'speed_loss') {
        return `${prefix}Focus on carrying more speed.`;
    }
    return `${prefix}Check your line.`;
}
