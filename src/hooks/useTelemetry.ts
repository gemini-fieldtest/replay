import { useState, useEffect, useRef, useCallback } from "react";
import { type TelemetryFrame } from "../utils/telemetryParser";
import {
  type LapData,
  calculateIdealLap, // We might still need this for type inference or if we run it locally
  detectLaps, // fallback
} from "../utils/lapAnalysis";

export function useTelemetry(
  source: string | File | null,
  startLine?: { lat: number; lon: number }
) {
  const [data, setData] = useState<TelemetryFrame[]>([]);
  const [laps, setLaps] = useState<LapData[]>([]);
  const [idealLap, setIdealLap] = useState<LapData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [isLooping, setIsLooping] = useState(false);

  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const playbackTimeRef = useRef<number>(0);

  // 1. Load Data (Worker)
  useEffect(() => {
    if (!source) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setData([]);
    setLaps([]); // Reset laps
    setIdealLap(null); // Reset ideal lap
    setCurrentIndex(0);
    setIsPlaying(false);

    let worker: Worker | null = null;

    const loadData = async () => {
      try {
        let text = "";
        if (typeof source === "string") {
          const res = await fetch(source);
          if (!res.ok) throw new Error(`Failed to fetch ${source}`);
          text = await res.text();
        } else if (source instanceof File) {
          text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = (e) => reject(e);
            reader.readAsText(source);
          });
        }

        // Spawn Worker
        worker = new Worker(new URL('../workers/telemetryWorker.ts', import.meta.url), { type: 'module' });

        worker.onmessage = (e) => {
            if (e.data.type === 'SUCCESS') {
                const { data: frames, laps: detectedLaps, idealLap: ideal } = e.data.payload;
                setData(frames);
                setLaps(detectedLaps);
                setIdealLap(ideal);
                setLoading(false);
                worker?.terminate();
            } else if (e.data.type === 'ERROR') {
                console.error("Worker error:", e.data.payload);
                setError(new Error(e.data.payload));
                setLoading(false);
                worker?.terminate();
            }
        };

        worker.onerror = (e) => {
            console.error("Worker error (system):", e);
            setError(new Error("Worker failed"));
            setLoading(false);
            worker?.terminate();
        }

        worker.postMessage({ type: 'PARSE_AND_ANALYZE', payload: { csvText: text, startLine } });

      } catch (err) {
        console.error(err);
        setError(err as Error);
        setLoading(false);
      }
    };

    loadData();

    // Cleanup: Terminate worker if component unmounts or source changes
    return () => {
        if (worker) {
            worker.terminate();
        }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);


  // 2. Re-Analyze if StartLine changes (and we already have data)
  // We disable the exhaustive-deps rule because we only want to run this when startLine changes,
  // NOT when data changes (data change is handled by the first effect).
  // However, `useEffect` dependencies must be exhaustive usually.

  // A cleaner pattern is to check if data is present.
  const isFirstRun = useRef(true);

  // Reset isFirstRun when data changes (new file loaded)
  useEffect(() => {
      isFirstRun.current = true;
  }, [data]);

  useEffect(() => {
      if (isFirstRun.current) {
          isFirstRun.current = false;
          return;
      }
      if (data.length === 0) return;

      // If startLine changes, re-calculate
      // console.log("Recalculating laps due to startLine change");
      const detectedLaps = detectLaps(data, startLine);
      setLaps(detectedLaps);
      if (detectedLaps.length > 0) {
        setIdealLap(calculateIdealLap(detectedLaps));
      } else {
        setIdealLap(null);
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLine]); // Only depend on startLine.


  // Ref-based loop to avoid closure staleness
  const stateRef = useRef({
    currentIndex: 0,
    data: [] as TelemetryFrame[],
    isPlaying: false,
    isLooping: false,
  });

  // Update refs when state changes
  useEffect(() => {
    stateRef.current.data = data;
    stateRef.current.isLooping = isLooping;
  }, [data, isLooping]);

  const loopRef = useRef<(time: number) => void>(() => {});

  const loop = useCallback(
    (time: number) => {
      // console.log('Loop', stateRef.current.isPlaying, time);
      if (!stateRef.current.isPlaying) return;

      // Initialize lastTimeRef if it's the first frame of playback
      if (lastTimeRef.current === undefined || lastTimeRef.current === 0) {
        lastTimeRef.current = time;
        requestRef.current = requestAnimationFrame(loopRef.current);
        return;
      }

      const deltaTimeMs = (time - lastTimeRef.current) * playbackSpeed;

      // Prevent huge jumps (e.g. tab switch or startup glitch)
      // If delta is > 500ms (at 1x), treat it as a skip
      const maxDelta = 500 * Math.max(1, playbackSpeed);

      let deltaSeconds = 0;
      if (deltaTimeMs > maxDelta) {
        // console.warn('Skipping large delta', deltaTimeMs);
        lastTimeRef.current = time; // reset baseline
        // Don't advance time
      } else {
        deltaSeconds = deltaTimeMs / 1000;
      }

      if (deltaSeconds > 0) {
        playbackTimeRef.current += deltaSeconds;

        const targetTime = playbackTimeRef.current;

        // Advance index until we reach targetTime
        let newIndex = stateRef.current.currentIndex;

        // Check if we need to move forward
        while (newIndex < stateRef.current.data.length - 1) {
          // Check next frame's time
          const nextTime = stateRef.current.data[newIndex + 1].time;
          if (nextTime > targetTime) {
            break;
          }
          newIndex++;
        }

        // If we reached the end
        if (newIndex >= stateRef.current.data.length - 1) {
          if (stateRef.current.isLooping) {
            // Loop back to start
            newIndex = 0;
            playbackTimeRef.current = stateRef.current.data[0].time;
          } else {
            setIsPlaying(false);
            stateRef.current.isPlaying = false; // Sync local state immediately
          }
        }

        // If we advanced (or looped), update state
        if (newIndex !== stateRef.current.currentIndex) {
          stateRef.current.currentIndex = newIndex;
          setCurrentIndex(newIndex);
        }
      }

      lastTimeRef.current = time;
      requestRef.current = requestAnimationFrame(loopRef.current);
    },
    [playbackSpeed]
  );

  useEffect(() => {
    // console.log('Loop updated', playbackSpeed);
    loopRef.current = loop;
  }, [loop, playbackSpeed]);

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      // Sync playback time to current frame time
      const currentFrame = stateRef.current.data[stateRef.current.currentIndex];
      if (currentFrame) {
        playbackTimeRef.current = currentFrame.time;
      }
      requestRef.current = requestAnimationFrame(loop);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, loop]);

  // Reset lastTime when speed changes to avoid huge jumps
  useEffect(() => {
    lastTimeRef.current = performance.now();
  }, [playbackSpeed]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const seek = (index: number) => {
    setCurrentIndex(index);
    stateRef.current.currentIndex = index;
    const frame = stateRef.current.data[index];
    if (frame) {
      playbackTimeRef.current = frame.time;
    }
  };

  // Helper to get ghost car frame
  const getGhostFrame = (
    currentFrame: TelemetryFrame | null
  ): TelemetryFrame | null => {
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
        // User Request: "it should wait for us at the start line"
        // instead of wrapping around.
        return idealLap.frames[0];
      }
    }

    if (!currentLap) return null;

    // Calculate relative time in current lap
    const relativeTime = currentFrame.time - currentLap.frames[0].time;

    // Binary search for the closest frame
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
    data,
    laps,
    idealLap,
    loading,
    error,
    currentIndex,
    currentFrame: data[currentIndex],
    getGhostFrame,
    isPlaying,
    togglePlay,
    seek,
    playbackSpeed,
    setPlaybackSpeed,
    isLooping,
    setIsLooping,
  };
}
