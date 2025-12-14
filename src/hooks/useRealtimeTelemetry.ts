import { useState, useEffect, useRef, useMemo } from "react";
import { type TelemetryFrame, parseTelemetry } from "../utils/telemetryParser";
import {
  detectLaps,
  calculateIdealLap,
  type LapData,
} from "../utils/lapAnalysis";

export function useRealtimeTelemetry(
  sourceUrl: string | null,
  startLine?: { lat: number; lon: number }
) {
  const [data, setData] = useState<TelemetryFrame[]>([]);
  // const [laps, setLaps] = useState<LapData[]>([]);
  // const [idealLap, setIdealLap] = useState<LapData | null>(null);

  // Keep a separate state for the absolute latest frame for gauges (60fps allowed)
  const [currentFrame, setCurrentFrame] = useState<TelemetryFrame | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isLive, setIsLive] = useState(true);

  // Internal buffer of the full session history (for static map/track bounds)
  const bufferRef = useRef<TelemetryFrame[]>([]);

  // Reconnection state
  const reconnectTimeoutRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const failedAttemptsRef = useRef(0);

  // Keep latest isLive in a ref to use inside event handlers without re-binding
  const isLiveRef = useRef(isLive);
  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    if (!sourceUrl) {
      setLoading(false);
      return;
    }

    // Cleanup function to run before new effect or unmount
    const cleanup = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const connect = () => {
      setLoading(true);
      // Only clear error if it's a fresh manual connection (attempts=0),
      // otherwise we might want to show "Reconnecting..."
      if (failedAttemptsRef.current === 0) {
        setError(null);
        setData([]);
        // setLaps([]) - derived from data now
        bufferRef.current = [];
        setCurrentFrame(null); // Clear current frame on new connection
      }

      console.log(
        `Connecting to SSE: ${sourceUrl} (Attempt ${
          failedAttemptsRef.current + 1
        })`
      );

      try {
        const eventSource = new EventSource(sourceUrl);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          console.log("SSE Connected");
          setLoading(false);
          setError(null);
          failedAttemptsRef.current = 0;
        };

        eventSource.onmessage = (event) => {
          if (!isLiveRef.current) return;

          try {
            const rawFrame = JSON.parse(event.data);
            let frame: TelemetryFrame | null = null;

            // GPSD Protocol Handling
            if (rawFrame.class === "TPV") {
              // TPV: Time Position Velocity
              const {
                lat,
                lon,
                alt,
                speed,
                track,
                time: timeStr,
                mode,
              } = rawFrame;

              // mode: 0=unknown, 1=no fix, 2=2D, 3=3D
              if (mode < 2) {
                // No fix or unknown
                return;
              }

              // Parse time from ISO8601 string if standard GPSD
              // Or if it's already a number (timestamp), use it.
              let time = 0;
              if (typeof timeStr === "string") {
                time = new Date(timeStr).getTime() / 1000;
              } else if (typeof timeStr === "number") {
                time = timeStr;
              } else {
                time = Date.now() / 1000;
              }

              // GPSD speed is m/s. Convert to km/h for the app
              const speedKmh = typeof speed === "number" ? speed * 3.6 : 0;

              frame = {
                time,
                latitude: lat,
                longitude: lon,
                altitude: alt || 0,
                speed: speedKmh,
                // Derived or Default values
                rpm: 0,
                throttle: 0,
                brake: 0,
                gear: 0,
                steering: track || 0, // Using track (heading) as steering proxy if needed, or 0
                gForceLat: 0,
                gForceLong: 0,
                batteryVoltage: 0,
                coolantTemp: 0,
                oilPressure: 0,
                oilTemp: 0,
                gradient: 0,
                fuelLevel: 0,
                brakePressure: 0,
                exhaustTemp: 0,
                comboG: 0,
                verticalVelocity: rawFrame.climb || 0, // climb is m/s
                radiusOfTurn: 0,
              };
            } else if (rawFrame.class === "SKY") {
              // Satellite view - ignored for now
            } else if (rawFrame.class === "ATT") {
              // Attitude (heading, pitch, roll) - useful but we rely on TPV for now
            } else {
              // Fallback for generic JSON stream (legacy/mock support)
              // Check if it looks like our old format (lat/lon/speed keys directly)
              if (
                rawFrame.lat !== undefined ||
                rawFrame.latitude !== undefined
              ) {
                // Legacy handling block
                const latitude =
                  typeof rawFrame.lat === "number"
                    ? rawFrame.lat
                    : rawFrame.latitude;
                const longitude =
                  typeof rawFrame.lon === "number"
                    ? rawFrame.lon
                    : rawFrame.longitude;
                const time =
                  typeof rawFrame.time === "number"
                    ? rawFrame.time
                    : Date.now() / 1000;

                if (
                  typeof latitude !== "number" ||
                  isNaN(latitude) ||
                  typeof longitude !== "number" ||
                  isNaN(longitude) ||
                  (Math.abs(latitude) < 0.01 && Math.abs(longitude) < 0.01)
                ) {
                  return;
                }

                frame = {
                  ...rawFrame,
                  latitude,
                  longitude,
                  time,
                  altitude: rawFrame.altitude || 0,
                  speed: rawFrame.speed || 0,
                  gForceLat: rawFrame.gForceLat || 0,
                  gForceLong: rawFrame.gForceLong || 0,
                  gradient: rawFrame.gradient || 0,
                  // Fill defaults if missing
                  rpm: rawFrame.rpm || 0,
                  throttle: rawFrame.throttle || 0,
                  brake: rawFrame.brake || 0,
                  gear: rawFrame.gear || 0,
                  steering: rawFrame.steering || 0,
                  batteryVoltage: 0,
                  coolantTemp: 0,
                  oilPressure: 0,
                  oilTemp: 0,
                  fuelLevel: 0,
                  brakePressure: 0,
                  exhaustTemp: 0,
                  comboG: 0,
                  verticalVelocity: 0,
                  radiusOfTurn: 0,
                };
              }
            }

            if (frame) {
              // Always update the buffer
              bufferRef.current.push(frame);

              // Update current frame immediately for smooth gauges
              setCurrentFrame(frame);

              // Update full history immediately (User requested realtime)
              // Note: As this array grows, performance impacting is inevitable in React
              setData((prev) => [...prev, frame!]);
            }
          } catch (e) {
            console.error("Error parsing SSE data", e);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE Error:", err);
          eventSource.close();

          // Set error to trigger UI feedback
          setError(new Error("Connection lost. Reconnecting..."));

          // Calculate backoff
          failedAttemptsRef.current++;
          const timeoutMs = Math.min(
            1000 * Math.pow(2, failedAttemptsRef.current),
            30000
          );

          console.log(`Reconnecting in ${timeoutMs}ms...`);
          reconnectTimeoutRef.current = window.setTimeout(connect, timeoutMs);
        };
      } catch (e) {
        console.error("Failed to create EventSource", e);
        setError(
          e instanceof Error ? e : new Error("Failed to create EventSource")
        );
      }
    };

    // Start connection
    failedAttemptsRef.current = 0; // Reset on source change
    if (
      sourceUrl &&
      !sourceUrl.endsWith(".csv") &&
      !sourceUrl.startsWith("blob:") &&
      sourceUrl !== "simulation"
    ) {
      connect();
    }

    return cleanup;
  }, [sourceUrl]); // Removed isLive from dependency to prevent reconnects on pause, handled via ref check

  // CSV Playback State
  const csvDataRef = useRef<TelemetryFrame[]>([]);

  // Load CSV Effect
  useEffect(() => {
    if (
      !sourceUrl ||
      (!sourceUrl.endsWith(".csv") && !sourceUrl.startsWith("blob:"))
    )
      return;

    let mounted = true;
    setLoading(true);
    setError(null);
    setData([]);
    // setLaps([]) - derived from data now
    bufferRef.current = [];
    setCurrentFrame(null);
    csvDataRef.current = [];

    const loadCsv = async () => {
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error("Failed to load CSV file");
        const text = await response.text();
        const frames = await parseTelemetry(text);

        if (mounted) {
          if (frames.length === 0) {
            setError(new Error("No valid telemetry frames found in CSV"));
          } else {
            // Sort by time just in case
            frames.sort((a, b) => a.time - b.time);

            // Normalize time to start at 0 if needed, or keep as is?
            // The simulation loop assumes normalized relative playback usually.
            // Let's normalize to 0-based relative time for easier looping.
            const startTime = frames[0].time;
            const normalized = frames.map((f) => ({
              ...f,
              time: f.time - startTime,
            }));

            csvDataRef.current = normalized;
            setLoading(false);
          }
        }
      } catch (err) {
        if (mounted) {
          console.error("Error loading CSV:", err);
          setError(
            err instanceof Error ? err : new Error("Failed to load CSV")
          );
          setLoading(false);
        }
      }
    };

    loadCsv();

    return () => {
      mounted = false;
    };
  }, [sourceUrl]);

  // Mock Simulation Data (Circular Track)
  const simulationData = useRef<[number, number][]>([]);
  useEffect(() => {
    if (simulationData.current.length === 0) {
      const centerLat = 37.7749;
      const centerLon = -122.4194;
      const radius = 0.005; // approx 500m
      const points = 360;
      for (let i = 0; i < points; i++) {
        const angle = (i * Math.PI) / 180;
        simulationData.current.push([
          centerLat + radius * Math.cos(angle),
          centerLon + radius * Math.sin(angle),
        ]);
      }
    }
  }, []);

  // Combined Simulation/CSV Playback Effect
  useEffect(() => {
    const isSimulation = sourceUrl === "simulation";
    const isCsv = sourceUrl?.endsWith(".csv") || sourceUrl?.startsWith("blob:");

    if (!isSimulation && !isCsv) return;

    // For CSV, wait until loaded
    if (isCsv && csvDataRef.current.length === 0) return;

    let animationFrameId: number;
    let startTime = Date.now();
    let playbackOffset = 0; // To handle pauses or loops?
    // Actually simpler: maintain a "virtual" elapsed time

    // Reset state for simulation/csv playback start
    // (Note: Load CSV effect handles its own reset, but 'simulation' case needs reset here if not handled elsewhere)
    if (isSimulation) {
      if (loading) setLoading(false);
      if (error) setError(null);
      if (simulationData.current.length > 0 && bufferRef.current.length === 0) {
        // Initialization for circle sim
      }
    }

    const animate = () => {
      if (!isLiveRef.current) {
        // If paused, we just update startTime so we don't jump when resuming?
        // Better: simplistic approach -> Pause stops the loop. Resume restarts/continues?
        // For smooth resume, we'd need to track "pausedAt".
        // Let's just poll.
        animationFrameId = requestAnimationFrame(animate);
        // Reset start time to maintain continuity or just drift?
        // If we want to essentially "pause time", we should stop advancing playbackOffset.
        startTime = Date.now() - playbackOffset;
        return;
      }

      const now = Date.now();
      playbackOffset = now - startTime;

      // Calculate current playback time in seconds
      // Using a speed multiplier? Default 1x.
      const elapsedSec = playbackOffset / 1000;

      let frame: TelemetryFrame | null = null;

      if (isCsv) {
        // Find frame corresponding to elapsedSec (looping)
        const totalDuration =
          csvDataRef.current[csvDataRef.current.length - 1].time;
        const loopTime = elapsedSec % totalDuration;

        // Binary search or Find for performance? Array size ~10k-20k.
        // Find is O(N), might be slow at 60fps.
        // Since time is sorted, we can optimize or just Use an index-based tracker if we assume forward only?
        // Binary search is safest for arbitrary time.
        // Or simpler: Assuming dense data, just find index.

        // Optimization: Remember last index?
        // Let's do a simple find for now, optimizing if needed.
        // actually loopTime increases monotonic usually.

        // Let's implement a rudimentary binary search for "frame just before loopTime"
        let low = 0;
        let high = csvDataRef.current.length - 1;
        let idx = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (csvDataRef.current[mid].time < loopTime) {
            idx = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        frame = csvDataRef.current[idx];
      } else if (isSimulation && simulationData.current.length > 0) {
        // Existing Circle Sim Logic
        // We can reuse the "index" based approach or switch to time based.
        // The old logic used "index" prop incrementing.
        // Let's stick to the old logic roughly but adapt to this loop?
        // Actually, the old logic was fine. I should have merged them or kept separate.
        // Integrating here to share the loop.

        const speedKmh = 120;
        const radius = 0.005; // ~500m logic
        // Simulating purely by index cycler for smoothness as before
        // 360 points.
        // Let's just pick based on time to be consistent.
        // Circle circumference approx: 2 * PI * 500m = 3141m.
        // Speed 120km/h = 33.3 m/s.
        // Lap time = 3141 / 33.3 = ~94 seconds.

        const totalDuration = 94;
        const loopTime = elapsedSec % totalDuration;
        const progress = loopTime / totalDuration; // 0 to 1

        const angle = progress * 2 * Math.PI;
        const centerLat = 37.7749;
        const centerLon = -122.4194;

        const lat = centerLat + radius * Math.cos(angle);
        const lon = centerLon + radius * Math.sin(angle);

        frame = {
          time: Date.now() / 1000, // Current real time, not file time
          latitude: lat,
          longitude: lon,
          altitude: 0,
          speed: speedKmh,
          rpm: 4000 + Math.sin(progress * Math.PI * 8) * 1000,
          throttle: 0.8,
          brake: 0,
          gear: 3,
          steering: Math.sin(progress * 2) * 20,
          gForceLat: Math.cos(progress * Math.PI * 2), // Fake G
          gForceLong: 0,
          batteryVoltage: 13.5,
          coolantTemp: 90,
          oilPressure: 45,
          oilTemp: 100,
          gradient: 0,
          fuelLevel: 50,
          brakePressure: 0,
          exhaustTemp: 400,
          comboG: 0,
          verticalVelocity: 0,
          radiusOfTurn: 0,
        };
      }

      if (frame) {
        // Update Buffer
        // For CSV, we might want to push ALL frames to buffer initially for map?
        // The 'data' state implies history.
        // The 'bufferRef' implies static map data.

        // In the CSV load effect, we didn't populate bufferRef.
        // But if we replay, we generate "live" history.
        // To show the WHOLE track on map immediately for CSV, we should probably
        // populate bufferRef with ALL csv data on load.

        // Remove pre-fill logic to simulate real-time arrival
        // The buffer and data will build up frame by frame below

        bufferRef.current.push(frame); // This might grow indefinitely in strict sim.
        setCurrentFrame(frame);

        // Throttled State Update for UI history (e.g. Map trail)
        // Reverted to full 60hz update per user request
        setData((prev) => [...prev, frame!]);
      }

      // Throttle loop? RequestAnimationFrame is approx 60fps.
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => cancelAnimationFrame(animationFrameId);
  }, [sourceUrl, loading]); // Re-run if source or loading state changes

  /* original simulation effect removed/merged above */

  // Analyze Laps (Memoized instead of Effect to prevent update loops)
  const laps = useMemo(() => {
    if (data.length === 0) return [];
    return detectLaps(data, startLine);
  }, [data, startLine]);

  const idealLap = useMemo(() => {
    if (laps.length === 0) return null;
    return calculateIdealLap(laps);
  }, [laps]);

  // Helper to get ghost car frame
  const getGhostFrame = (): TelemetryFrame | null => {
    // Use local currentFrame if available, otherwise we can't calc ghost

    if (!currentFrame || !idealLap || !laps.length) return null;

    // Find which lap we are in
    let currentLap = laps.find(
      (l) =>
        currentFrame.time >= l.frames[0].time &&
        currentFrame.time <= l.frames[l.frames.length - 1].time
    );

    // Fallback: If not found, but we are after the last lap, use the last lap
    if (!currentLap && laps.length > 0) {
      const lastLap = laps[laps.length - 1];
      if (currentFrame.time > lastLap.frames[lastLap.frames.length - 1].time) {
        currentLap = lastLap;
      } else if (currentFrame.time < laps[0].frames[0].time) {
        // Rolling Start: We are before the first lap (Out Lap)
        // Show the ghost finishing the previous lap (wrap around)
        const timeToStart = laps[0].frames[0].time - currentFrame.time;

        // Only show if within reasonable range (e.g. one lap duration)
        if (timeToStart < idealLap.lapTime) {
          const ghostTime = idealLap.lapTime - timeToStart;
          // Find frame in ideal lap
          const ghostFrame = idealLap.frames.find(
            (f) => f.time >= idealLap.frames[0].time + ghostTime
          );
          return ghostFrame || idealLap.frames[idealLap.frames.length - 1];
        }
        return null;
      }
    }

    if (!currentLap) return null;

    // Calculate relative time in current lap
    const relativeTime = currentFrame.time - currentLap.frames[0].time;

    // Binary search for the closest frame in ideal lap
    let low = 0;
    let high = idealLap.frames.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (idealLap.frames[mid].time < relativeTime) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return idealLap.frames[bestIdx];
  };

  return {
    data, // This is now throttled history (good for map)
    laps,
    idealLap,
    loading,
    error,
    currentIndex: data.length - 1,
    currentFrame, // This needs to be the latest
    getGhostFrame,
    isPlaying: isLive,
    togglePlay: () => setIsLive(!isLive),
    fullTrackBuffer: data, // Expose full buffer if needed
  };
}
