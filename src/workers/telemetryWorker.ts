import { parseTelemetry } from '../utils/telemetryParser';
import { detectLaps, calculateIdealLap } from '../utils/lapAnalysis';

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'PARSE_AND_ANALYZE') {
    try {
      const { csvText, startLine } = payload;

      // 1. Parse CSV
      const frames = await parseTelemetry(csvText);

      // 1.1 Calculate Track Geometry (Heading and Slope)
      // This is efficient to do once in the worker rather than per-frame in the UI
      if (frames.length > 1) {
          for (let i = 0; i < frames.length; i++) {
              const current = frames[i];

              // Determine next and previous points for smooth calculation
              // We use a small window if possible, or just next point
              const prev = frames[Math.max(0, i - 1)];
              const next = frames[Math.min(frames.length - 1, i + 1)];

              // 1. Heading (Track Angle)
              // Note: This is geographic heading.
              // We can convert Lat/Lon delta to local meters to get accurate heading
              // R = 6371e3
              // x = dLon * cos(lat) * R
              // z = dLat * R

              // We use next point for heading if available, otherwise fallback to prev (end of track)
              let p1 = current;
              let p2 = next;

              if (i === frames.length - 1) {
                  p1 = prev;
                  p2 = current;
              }

              const dLat = (p2.latitude - p1.latitude) * (Math.PI / 180);
              const dLon = (p2.longitude - p1.longitude) * (Math.PI / 180);

              // Simple flat earth projection for heading is usually sufficient for short distances
              // But let's be proper with scaling
              const latRad = current.latitude * (Math.PI / 180);
              const dx = dLon * Math.cos(latRad);
              const dy = dLat;

              // Heading: 0 is North (Positive Y), 90 is East (Positive X)
              // atan2(x, y) gives angle from Y axis (North)
              // But standard Math.atan2(y, x) gives angle from X axis.
              // Let's store standard math angle (radians from East) or visual Heading?
              // The 3D component usually expects 0 = North? Or just aligns mesh?
              // The 3D component does: Math.atan2(dx, dz) where Z is forward?
              // Let's stick to what we used to calculate: Geographic Heading.

              // current.trackHeading = Math.atan2(dx, dy); // This is approximate heading

              // 2. Slope (Gradient)
              // Rise / Run
              // Run = Distance
              const R = 6371e3;
              const dist = Math.sqrt(dx*dx + dy*dy) * R;
              const dAlt = p2.altitude - p1.altitude;

              if (dist > 0.1) {
                  current.trackSlope = Math.atan2(dAlt, dist);
              } else {
                  current.trackSlope = 0;
              }
          }
      }

      // 2. Detect Laps
      const laps = detectLaps(frames, startLine);

      // 3. Calculate Ideal Lap
      const idealLap = laps.length > 0 ? calculateIdealLap(laps) : null;

      self.postMessage({
        type: 'SUCCESS',
        payload: {
          data: frames,
          laps,
          idealLap
        }
      });
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        payload: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
