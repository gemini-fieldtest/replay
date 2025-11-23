import { type TelemetryFrame } from './telemetryParser';

export interface LapData {
  lapIndex: number;
  frames: TelemetryFrame[];
  totalDistance: number;
  lapTime: number;
  sectors?: number[]; // Indices of sector boundaries
  isComplete: boolean;
}

// Distance between two lat/lon points in meters (Haversine formula)
function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export function detectLaps(frames: TelemetryFrame[]): LapData[] {
  if (frames.length < 100) return [];

  // Heuristic: Try a few candidate start positions from the beginning of the data
  // to handle cases where the recording starts in the pits or off-track.
  // We'll check the first 3 minutes of data (approx 10000 frames at 60Hz)
  // or 20% of the data, whichever is smaller, stepping every 5 seconds (300 frames).
  const searchLimit = Math.min(frames.length, 10000); // ~3 mins
  const step = 300; // ~5 seconds
  
  let bestLaps: LapData[] = [];

  // Helper to detect laps for a given start position
  const findLapsForPos = (startPos: { lat: number, lon: number }) => {
    const detectedLaps: LapData[] = [];
    let currentLap: TelemetryFrame[] = [];
    let lastDist = Infinity;
    let lapStartTime = frames[0].time;
    let onLap = false;
    
    // Thresholds
    const START_FINISH_PROXIMITY = 20; // meters
    const MIN_LAP_TIME = 30; // seconds

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const dist = getDistanceFromLatLonInM(frame.latitude, frame.longitude, startPos.lat, startPos.lon);

      // Check for start/finish crossing
      // We look for a local minimum in distance that is within the proximity threshold
      if (dist < START_FINISH_PROXIMITY) {
        // We are close to the start line.
        // To avoid multiple triggers for the same crossing, we wait until distance starts increasing
        // and we are far enough in time/distance from the last crossing.
        
        if (dist > lastDist && lastDist < START_FINISH_PROXIMITY) {
             // Local minimum passed in the previous frame
             // const crossIndex = i - 1;
             const timeSinceLast = frame.time - lapStartTime;

             if (timeSinceLast > MIN_LAP_TIME) {
                 if (onLap) {
                     // Complete the current lap
                     // Calculate distance
                     let lapDist = 0;
                     for(let k=0; k<currentLap.length-1; k++) {
                         lapDist += getDistanceFromLatLonInM(
                             currentLap[k].latitude, currentLap[k].longitude,
                             currentLap[k+1].latitude, currentLap[k+1].longitude
                         );
                     }

                     detectedLaps.push({
                         lapIndex: detectedLaps.length + 1,
                         lapTime: timeSinceLast,
                         frames: [...currentLap],
                         totalDistance: lapDist,
                         isComplete: true
                     });
                 }
                 
                 // Start new lap
                 onLap = true;
                 currentLap = [];
                 lapStartTime = frames[i-1].time;
             }
        }
      }
      
      if (onLap) {
          currentLap.push(frame);
      }
      
      lastDist = dist;
    }

    // Handle final partial lap
    if (onLap && currentLap.length > 0) {
        let lapDist = 0;
        for(let k=0; k<currentLap.length-1; k++) {
            lapDist += getDistanceFromLatLonInM(
                currentLap[k].latitude, currentLap[k].longitude,
                currentLap[k+1].latitude, currentLap[k+1].longitude
            );
        }
        detectedLaps.push({
            lapIndex: detectedLaps.length + 1,
            lapTime: currentLap[currentLap.length-1].time - lapStartTime,
            frames: [...currentLap],
            totalDistance: lapDist,
            isComplete: false
        });
    }

    return detectedLaps;
  };

  // Try candidates
  for (let i = 0; i < searchLimit; i += step) {
      const candidatePos = { lat: frames[i].latitude, lon: frames[i].longitude };
      const laps = findLapsForPos(candidatePos);
      
      // We prefer more COMPLETE laps
      const completeLaps = laps.filter(l => l.isComplete).length;
      const bestCompleteLaps = bestLaps.filter(l => l.isComplete).length;

      if (completeLaps > bestCompleteLaps) {
          bestLaps = laps;
      } else if (completeLaps === bestCompleteLaps && laps.length > bestLaps.length) {
          bestLaps = laps;
      }
  }

  return bestLaps;
}


// Resample a lap to have data points at fixed distance intervals
export function resampleLap(lap: LapData, stepMeters: number = 5): LapData {
    if (!lap.frames || lap.frames.length < 2) return lap;

    const newFrames: TelemetryFrame[] = [];
    const totalDist = lap.totalDistance;
    
    // Create distance map for original frames
    const distMap: number[] = [0];
    let accumDist = 0;
    for (let i = 0; i < lap.frames.length - 1; i++) {
        const d = getDistanceFromLatLonInM(
            lap.frames[i].latitude, lap.frames[i].longitude,
            lap.frames[i+1].latitude, lap.frames[i+1].longitude
        );
        accumDist += d;
        distMap.push(accumDist);
    }

    // Interpolate
    for (let d = 0; d <= totalDist; d += stepMeters) {
        // Find surrounding frames
        // distMap[i] <= d < distMap[i+1]
        let idx = distMap.findIndex(val => val >= d);
        if (idx === -1) idx = distMap.length - 1;
        if (idx === 0) idx = 1; // Should not happen if d > 0, but safety

        const i1 = idx - 1;
        const i2 = idx;
        
        const d1 = distMap[i1];
        const d2 = distMap[i2];
        const ratio = (d - d1) / (d2 - d1 || 1); // Avoid div by zero

        const f1 = lap.frames[i1];
        const f2 = lap.frames[i2];

        // Linear interpolation helper
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        const newFrame: TelemetryFrame = {
            ...f1,
            time: lerp(f1.time, f2.time, ratio),
            latitude: lerp(f1.latitude, f2.latitude, ratio),
            longitude: lerp(f1.longitude, f2.longitude, ratio),
            speed: lerp(f1.speed, f2.speed, ratio),
            rpm: lerp(f1.rpm, f2.rpm, ratio),
            throttle: lerp(f1.throttle, f2.throttle, ratio),
            brake: lerp(f1.brake, f2.brake, ratio),
            gear: f1.gear, // Discrete
            steering: lerp(f1.steering, f2.steering, ratio),
            gForceLat: lerp(f1.gForceLat, f2.gForceLat, ratio),
            gForceLong: lerp(f1.gForceLong, f2.gForceLong, ratio),
            altitude: lerp(f1.altitude, f2.altitude, ratio),
            gradient: lerp(f1.gradient, f2.gradient, ratio),
            // ... copy other fields or lerp if needed
        };
        newFrames.push(newFrame);
    }

    return {
        ...lap,
        frames: newFrames,
        totalDistance: totalDist // Keep original total distance? Or new?
    };
}


export function calculateIdealLap(laps: LapData[], microSectorSize: number = 50): LapData | null {
    const completeLaps = laps.filter(l => l.isComplete);
    if (completeLaps.length < 2) return null;

    // 1. Resample all laps to same grid
    const step = 5; // 5 meters resolution
    const resampledLaps = completeLaps.map(l => resampleLap(l, step));

    // 2. Normalize distances? 
    // Laps might have slightly different lengths. 
    // We should truncate to the shortest lap length to ensure alignment, 
    // or stretch/squash. For simplicity, let's truncate to min length.
    const minLen = Math.min(...resampledLaps.map(l => l.frames.length));
    
    // 3. Split into micro-sectors
    // microSectorSize is in meters. Since step is 5m, indices per sector = size / 5
    const indicesPerSector = Math.floor(microSectorSize / step);
    const numSectors = Math.floor(minLen / indicesPerSector);

    const idealFrames: TelemetryFrame[] = [];
    let currentIdealTime = 0;

    for (let s = 0; s < numSectors; s++) {
        const startIdx = s * indicesPerSector;
        const endIdx = startIdx + indicesPerSector;

        // Find best lap for this sector
        let bestLapIdx = -1;
        let bestSectorTime = Infinity;

        for (let l = 0; l < resampledLaps.length; l++) {
            const lap = resampledLaps[l];
            // Calculate time taken for this sector
            const tStart = lap.frames[startIdx].time;
            const tEnd = lap.frames[Math.min(endIdx, lap.frames.length-1)].time;
            const dt = tEnd - tStart;
            
            if (dt < bestSectorTime) {
                bestSectorTime = dt;
                bestLapIdx = l;
            }
        }

        // Stitch
        // We take the frames from the best lap, BUT we must adjust the timestamps
        // so they flow continuously from the previous sector.
        const bestLap = resampledLaps[bestLapIdx];
        const sectorFrames = bestLap.frames.slice(startIdx, Math.min(endIdx, bestLap.frames.length));
        
        const sectorStartTime = sectorFrames[0].time;
        
        for (const frame of sectorFrames) {
            const relativeTime = frame.time - sectorStartTime;
            idealFrames.push({
                ...frame,
                time: currentIdealTime + relativeTime
            });
        }
        
        currentIdealTime += bestSectorTime;
    }

    return {
        lapIndex: -1, // ID for Ideal Lap
        frames: idealFrames,
        totalDistance: idealFrames.length * step,
        lapTime: currentIdealTime,
        isComplete: true
    };
}
