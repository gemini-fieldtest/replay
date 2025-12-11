import { useMemo } from 'react';
import type { TelemetryFrame } from '../utils/telemetryParser';

export interface TrackPoint {
  name: string;
  lat: number;
  long: number;
}

export function useTrackLocation(currentFrame: TelemetryFrame | null, points: TrackPoint[], thresholdMeters: number = 100) {
    return useMemo(() => {
        if (!currentFrame || !points || points.length === 0) return null;

        let bestPoint: TrackPoint | null = null;
        let minDist = Infinity;

        // Haversine Formula
        const R = 6371e3; // metres
        const lat1 = currentFrame.latitude * Math.PI / 180;

        for (const point of points) {
            // Filter out timestamp-named points (often used for internal markers) if they exist and we only want human readable ones
            // Based on points.json seen, some are "Start", "1", "2", others are timestamps "1721..."
            // We likely prefer short names "1", "2" or "start"
            if (point.name.length > 10 && !isNaN(parseInt(point.name))) continue;

            const lat2 = point.lat * Math.PI / 180;
            const dLat = (point.lat - currentFrame.latitude) * Math.PI / 180;
            const dLon = (point.long - currentFrame.longitude) * Math.PI / 180;

            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1) * Math.cos(lat2) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const d = R * c;

            if (d < minDist) {
                minDist = d;
                bestPoint = point;
            }
        }

        if (bestPoint && minDist < thresholdMeters) {
            // Format for AI
            // If name is number, "Turn X". If "start", "Start/Finish".
            const name = bestPoint.name;
            
            if (name.toLowerCase() === 'start' || name.toLowerCase() === 'finish') {
                return "Start/Finish Line";
            }
            
            // If simple number, assume Turn
            if (!isNaN(parseInt(name))) {
                return `Turn ${name}`;
            }

            return `${name}`;
        }

        return null;

    }, [currentFrame, points, thresholdMeters]);
}
