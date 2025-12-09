import { useState, useEffect, useRef } from 'react';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { detectLaps, calculateIdealLap, type LapData } from '../utils/lapAnalysis';

export function useRealtimeTelemetry(sourceUrl: string | null) {
  const [data, setData] = useState<TelemetryFrame[]>([]);
  const [laps, setLaps] = useState<LapData[]>([]);
  const [idealLap, setIdealLap] = useState<LapData | null>(null);
  
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
             setLaps([]);
             bufferRef.current = [];
             setCurrentFrame(null); // Clear current frame on new connection
        }

        console.log(`Connecting to SSE: ${sourceUrl} (Attempt ${failedAttemptsRef.current + 1})`);
        
        try {
            const eventSource = new EventSource(sourceUrl);
            eventSourceRef.current = eventSource;

            eventSource.onopen = () => {
                console.log('SSE Connected');
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
                    if (rawFrame.class === 'TPV') {
                        // TPV: Time Position Velocity
                        const { lat, lon, alt, speed, track, time: timeStr, mode } = rawFrame;

                        // mode: 0=unknown, 1=no fix, 2=2D, 3=3D
                        if (mode < 2) {
                            // No fix or unknown
                            return;
                        }
                        
                        // Parse time from ISO8601 string if standard GPSD
                        // Or if it's already a number (timestamp), use it.
                        let time = 0;
                        if (typeof timeStr === 'string') {
                            time = new Date(timeStr).getTime() / 1000;
                        } else if (typeof timeStr === 'number') {
                            time = timeStr;
                        } else {
                            time = Date.now() / 1000;
                        }

                        // GPSD speed is m/s. Convert to km/h for the app
                        const speedKmh = (typeof speed === 'number') ? speed * 3.6 : 0;

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
                            radiusOfTurn: 0
                        };

                    } else if (rawFrame.class === 'SKY') {
                        // Satellite view - ignored for now
                    } else if (rawFrame.class === 'ATT') {
                        // Attitude (heading, pitch, roll) - useful but we rely on TPV for now
                    } else {
                         // Fallback for generic JSON stream (legacy/mock support)
                         // Check if it looks like our old format (lat/lon/speed keys directly)
                         if (rawFrame.lat !== undefined || rawFrame.latitude !== undefined) {
                             // Legacy handling block
                            const latitude = typeof rawFrame.lat === 'number' ? rawFrame.lat : rawFrame.latitude;
                            const longitude = typeof rawFrame.lon === 'number' ? rawFrame.lon : rawFrame.longitude;
                            const time = typeof rawFrame.time === 'number' ? rawFrame.time : (Date.now() / 1000);
        
                            if (
                                typeof latitude !== 'number' || isNaN(latitude) ||
                                typeof longitude !== 'number' || isNaN(longitude)
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
                                batteryVoltage: 0, coolantTemp: 0, oilPressure: 0, oilTemp: 0, fuelLevel: 0, brakePressure: 0, exhaustTemp: 0, comboG: 0, verticalVelocity: 0, radiusOfTurn: 0
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
                        setData(prev => [...prev, frame!]);
                    }

                } catch (e) {
                    console.error('Error parsing SSE data', e);
                }
            };

            eventSource.onerror = (err) => {
                console.error('SSE Error:', err);
                eventSource.close();
                
                // Set error to trigger UI feedback
                setError(new Error('Connection lost. Reconnecting...'));

                // Calculate backoff
                failedAttemptsRef.current++;
                const timeoutMs = Math.min(1000 * Math.pow(2, failedAttemptsRef.current), 30000);
                
                console.log(`Reconnecting in ${timeoutMs}ms...`);
                reconnectTimeoutRef.current = window.setTimeout(connect, timeoutMs);
            };
        } catch (e) {
            console.error("Failed to create EventSource", e);
            setError(e instanceof Error ? e : new Error('Failed to create EventSource'));
        }
    };

    // Start connection
    failedAttemptsRef.current = 0; // Reset on source change
    connect();

    return cleanup;
  }, [sourceUrl]); // Removed isLive from dependency to prevent reconnects on pause, handled via ref check


  // Analyze Laps when data changes
  // Note: For long sessions, running this on every frame might become expensive.
  // Consider throttling or optimizing in future.
  useEffect(() => {
    if (data.length === 0) return;
    
    // Also laps calculation could be expensive on big array, good thing data is throttled now
    const detected = detectLaps(data);
    setLaps(detected);
    if (detected.length > 0) {
        setIdealLap(calculateIdealLap(detected));
    }
  }, [data]);

  
  return {
    data, // This is now throttled history (good for map)
    laps,
    idealLap,
    loading,
    error,
    currentIndex: data.length - 1,
    currentFrame, // This needs to be the latest
    getGhostFrame: () => null,
    isPlaying: isLive,
    togglePlay: () => setIsLive(!isLive),
    fullTrackBuffer: data // Expose full buffer if needed
  };
}
