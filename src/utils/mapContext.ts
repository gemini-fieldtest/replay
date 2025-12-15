import type { TrackPoint } from '../hooks/useTrackLocation';

/**
 * Calculates distance between two coordinates in meters using Haversine formula
 */
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Generates a context string listing map points near the current location.
 * @param currentLat Current Latitude
 * @param currentLon Current Longitude
 * @param points List of TrackPoints (from points.json)
 * @param radius Search radius in meters (default 500m)
 * @returns Formatted string for AI context or empty string if no points nearby
 */
export function getNearbyMapContext(
    currentLat: number,
    currentLon: number,
    points: TrackPoint[],
    radius: number = 500
): string {
    if (!points || points.length === 0) return "";

    // Find points within radius
    const nearbyPoints = points
        .map(p => {
            const dist = getDistance(currentLat, currentLon, p.lat, p.long);
            return { ...p, dist };
        })
        .filter(p => p.dist <= radius)
        .sort((a, b) => a.dist - b.dist); // Closest first

    if (nearbyPoints.length === 0) return "";

    // Take top 3 closest points to avoid flooding context
    const topPoints = nearbyPoints.slice(0, 3);

    const pointDescriptions = topPoints.map(p => {
        let name = p.name;
        // Normalize names for readability
        if (!isNaN(parseInt(name))) {
            name = `Turn ${name}`;
        }
        return `${name} (${Math.round(p.dist)}m away)`;
    });

    return `Nearby Map: ${pointDescriptions.join(", ")}`;
}
