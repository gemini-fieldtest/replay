import { parseTelemetry } from '../utils/telemetryParser';
import { detectLaps, calculateIdealLap } from '../utils/lapAnalysis';

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'PARSE_AND_ANALYZE') {
    try {
      const { csvText, startLine } = payload;

      // 1. Parse CSV
      const frames = await parseTelemetry(csvText);

      // 1.1 Pre-calculate track geometry (Heading/Slope)
      // This avoids doing it per-frame in the 3D view
      // We assume frames are sequential in time/distance
      // Convert to Cartesian (approximate) to calculate heading?
      // Or just use lat/lon delta?
      // For heading: atan2(dLon, dLat) works if scaling is correct, but conversion to meters is better.
      // Actually TrackMap3D uses the 3D positions (Float32Array) which are converted from lat/lon.
      // But we don't have the 3D positions here easily (they are converted in useTrackLocation or similar).
      // However, we can estimate heading from Lat/Lon.
      // But TrackMap3D uses the *Projected* positions for rendering.
      // Using Lat/Lon heading might be slightly off from the projected visual heading if projection distorts.
      // BUT, usually visual heading matches lat/lon heading.

      // Let's postpone this specific pre-calculation if it requires the Projection logic which is in a Hook or Component.
      // UseTrackLocation uses `d3-geo` or similar? No, let's check.
      // If we can't do it here easily, we can do it in the Component ONCE when positions are generated.
      // That is also efficient.

      // So let's stick to parsing and lap analysis here.

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
