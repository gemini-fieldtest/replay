import { useState, useEffect, useRef, useCallback } from 'react';
import { type TelemetryFrame, parseTelemetry } from '../utils/telemetryParser';
import { detectLaps, calculateIdealLap, type LapData } from '../utils/lapAnalysis';

export function useTelemetry(source: string | File | null) {
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

  useEffect(() => {
    if (!source) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setData([]);
    setLaps([]);
    setIdealLap(null);
    setCurrentIndex(0);
    setIsPlaying(false);

    const loadData = async () => {
      try {
        let text = '';
        if (typeof source === 'string') {
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

        const frames = await parseTelemetry(text);
        setData(frames);
        
        // Process Laps
        const detectedLaps = detectLaps(frames);
        setLaps(detectedLaps);
        
        if (detectedLaps.length > 0) {
            const ideal = calculateIdealLap(detectedLaps);
            setIdealLap(ideal);
        }

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError(err as Error);
        setLoading(false);
      }
    };

    loadData();
  }, [source]);

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

  const loop = useCallback((time: number) => {
    // console.log('Loop', stateRef.current.isPlaying, time);
    if (!stateRef.current.isPlaying) return;
    
    if (lastTimeRef.current !== undefined) {
      const deltaTime = (time - lastTimeRef.current) * playbackSpeed; // ms
      // Convert to seconds for telemetry time comparison
      const deltaSeconds = deltaTime / 1000;
      
      playbackTimeRef.current += deltaSeconds;
      const targetTime = playbackTimeRef.current;
      
      // Advance index until we reach targetTime
      let newIndex = stateRef.current.currentIndex;
      
      // Optimization: start from current index
      // If we are behind (e.g. looped or seeked back), we might need to handle that?
      // But playbackTimeRef should be synced.
      
      // Check if we need to move forward
      while (newIndex < stateRef.current.data.length - 1) {
        if (stateRef.current.data[newIndex + 1].time > targetTime) {
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
  }, [playbackSpeed]);

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
  const getGhostFrame = (currentFrame: TelemetryFrame | null): TelemetryFrame | null => {
      if (!currentFrame || !idealLap || !laps.length) return null;
      
      // Find which lap we are in
      let currentLap = laps.find(l => 
          currentFrame.time >= l.frames[0].time && 
          currentFrame.time <= l.frames[l.frames.length-1].time
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
                 // Binary search or find
                 const ghostFrame = idealLap.frames.find(f => f.time >= idealLap.frames[0].time + ghostTime);
                 return ghostFrame || idealLap.frames[idealLap.frames.length-1];
             }
             return null;
          }
      }

      if (!currentLap) return null;
      
      // Calculate relative time in current lap
      const relativeTime = currentFrame.time - currentLap.frames[0].time;
      
      // Find corresponding frame in ideal lap
      // Ideal lap frames start at time 0 relative to start of ideal lap
      // We need to find frame with time <= relativeTime
      
      // Binary search or simple find? Ideal lap is sorted by time.
      // Simple find for now, optimization later if needed.
      // Since we play forward, we could cache index?
      
      // Let's assume idealLap.frames are sorted by time.
      // Find index where frame.time is closest to relativeTime
      
      // Optimization: use ratio of distance? 
      // Ideally we compare by DISTANCE, not time, to see who is ahead.
      // But the ghost car should be at the same TIME offset to show "Ghost".
      // i.e. "Where was the ideal lap at this same duration into the lap?"
      
      // Yes, Ghost Car usually means "Replay of best lap synchronized by time".
      
      // Find frame in idealLap with time ~ relativeTime
      // idealLap.frames[i].time is relative to 0
      
      // Simple linear search for now, assuming 60hz it's fast enough
      // Or just use ratio if we want smooth interpolation
      
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
      
      // Interpolate? For now just return the closest previous frame
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
