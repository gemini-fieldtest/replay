import { useState, useEffect, useRef, useCallback } from 'react';
import { type TelemetryFrame, parseTelemetry } from '../utils/telemetryParser';

export function useTelemetry(source: string | File | null) {
  const [data, setData] = useState<TelemetryFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  
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
  });
  
  // Update refs when state changes
  useEffect(() => {
    stateRef.current.data = data;
  }, [data]);
  
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
      
      // If we advanced, update state
      if (newIndex !== stateRef.current.currentIndex) {
        stateRef.current.currentIndex = newIndex;
        setCurrentIndex(newIndex);
      }
      
      // If we reached the end
      if (newIndex >= stateRef.current.data.length - 1) {
        setIsPlaying(false);
      }
    }
    
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(loopRef.current);
  }, [playbackSpeed]);

  useEffect(() => {
    console.log('Loop updated', playbackSpeed);
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

  return {
    data,
    loading,
    error,
    currentIndex,
    currentFrame: data[currentIndex],
    isPlaying,
    togglePlay,
    seek,
    playbackSpeed,
    setPlaybackSpeed,
  };
}
