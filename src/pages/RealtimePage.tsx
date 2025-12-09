import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRealtimeTelemetry } from '../hooks/useRealtimeTelemetry';
import { Play, Pause, Trophy, Radio } from 'lucide-react';
import { PitView } from './PitView';
import { DriverView } from './DriverView';
import { PerformanceCoach } from './PerformanceCoach';
import thunderhillData from '../data/tracks/thunderhill_east.json';
import { type TelemetryFrame } from '../utils/telemetryParser';



export const RealtimePage = () => {
  // Default to localhost telemetry server
  const [sourceUrl, setSourceUrl] = useState<string | null>('http://localhost:8000/events');
  const [selectedTrackId, setSelectedTrackId] = useState<string>('thunderhill_east');
  
  const mapRotation = -Math.PI / 2; // 90 deg Right (was 90 deg Left = PI/2, so diff is PI)
  
  // Layout State
  const [showPitView, setShowPitView] = useState(true);
  const [showDriverView, setShowDriverView] = useState(true);
  const [showCoachView, setShowCoachView] = useState(true);
  const [splitPosition, setSplitPosition] = useState(50); // Percentage for the split
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { 
    data,
    loading, 
    error, 
    currentFrame, 
    currentIndex, 
    isPlaying: isLive, 
    togglePlay: toggleLive, 

    idealLap,
    laps,
    getGhostFrame,
    // fullTrackBuffer is unused in this version of projection logic
  } = useRealtimeTelemetry(sourceUrl, thunderhillData.configurations[0].trackPath);

  const [showGhost, setShowGhost] = useState(true);

  // Virtual Start Point (User's actual location when session starts or reset)
  const [virtualStart, setVirtualStart] = useState<{lat: number, lon: number, alt: number} | null>(null);
  const [pathRotation, setPathRotation] = useState(0);
  const [manualShiftX, setManualShiftX] = useState(0);
  const [manualShiftZ, setManualShiftZ] = useState(0);
  
  // Track Anchor: Which index of the static track path are we "snapped" to?
  const [trackAnchorIndex, setTrackAnchorIndex] = useState(0);
  const [sessionStartTime] = useState(Date.now()); // For phase detection

  // SHAPE MATCHING: Finds best anchor by comparing HISTORY SHAPE to TRACK SHAPE
  // Returns { index, error }
  const findBestTrackAnchorShape = useCallback((history: TelemetryFrame[], searchStartIdx: number = 0, searchRadius: number = -1) => {
      const trackPath = thunderhillData.configurations[0].trackPath;
      if (!trackPath || trackPath.length < 2 || history.length < 2) return { index: 0, error: Infinity };

      // Sample history to reduce compute (e.g. 1 point every ~10 frames/1s)
      // If history is 2 mins (120s), we have ~1200 frames. Use ~50 points.
      const step = Math.max(1, Math.floor(history.length / 50));
      const sample: TelemetryFrame[] = [];
      for(let i=0; i<history.length; i+=step) sample.push(history[i]);
      
      // We align the LATEST history point to the CANDIDATE track point.
      // Then we check the error of previous points.
      
      let bestIdx = searchStartIdx;
      let minError = Infinity;
      
      const start = searchRadius > 0 ? Math.max(0, searchStartIdx - searchRadius) : 0;
      const end = searchRadius > 0 ? Math.min(trackPath.length - 1, searchStartIdx + searchRadius) : trackPath.length - 1;

      for (let i = start; i < end; i++) {
          // Candidate Anchor Point on Track
          const anchorT = trackPath[i];
          const anchorU = sample[sample.length-1]; // Latest user point
          
          // Calculate offset to align Latest User to Candidate Track
          const dLat = anchorT[0] - anchorU.latitude;
          const dLon = anchorT[1] - anchorU.longitude;
          
          // Re-implementing with 3-Keypoint Match for Speed + Stability
          // const k1 = sample[sample.length-1]; // Start (Latest) - already used as anchorU
          const k2 = sample[Math.floor(sample.length/2)]; // Mid
          const k3 = sample[0]; // End (Oldest) of window
          
          let err = 0;
          [k2, k3].forEach(p => {
               const pLat = p.latitude + dLat;
               const pLon = p.longitude + dLon;
               
               // Find closest track point near i (scan back 1000m?)
               let localMin = Infinity;
               // Heuristic scan range
               for (let j = Math.max(0, i - 200); j <= i; j++) {
                   const tp = trackPath[j];
                   // Euclidean approximation for speed
                   const dd = (tp[0]-pLat)**2 + (tp[1]-pLon)**2;
                   if (dd < localMin) localMin = dd;
               }
               err += localMin;
          });
          
          if (err < minError) {
              minError = err;
              bestIdx = i;
          }
      }
      return { index: bestIdx, error: minError };
  }, []); // Stable

  // Real implementation of throttled alignment
  const lastAlignTime = useRef(0);
  
  useEffect(() => {
      if (!data || data.length < 10) return;
      const now = Date.now();
      
      // PHASE LOGIC
      const sessionDuration = now - sessionStartTime;
      const phase = sessionDuration < 30000 ? 'DISCOVERY' : 'TRACKING';
      const interval = phase === 'DISCOVERY' ? 2000 : 15000; // 2s vs 15s
      
      if (now - lastAlignTime.current < interval) return; 
      
      const f = data[data.length - 1];
      if (f.speed < 5) return; 

      // LOOKBACK WINDOW
      // Phase 1: Use whatever we have (up to 30s)
      // Phase 2: Use up to 120s (2 mins)
      const maxHistory = phase === 'DISCOVERY' ? 30 : 120; // seconds
      // Estimate frames (assuming 10hz). 120s = 1200 frames.
      const frameCount = maxHistory * 10; 
      const startIdx = Math.max(0, data.length - frameCount);
      const history = data.slice(startIdx);
      
      // SEARCH RADIUS
      // Discovery: Global (-1). Tracking: Local (300 points)
      const searchRadius = phase === 'DISCOVERY' ? -1 : 300; 
      
      // Execute Match
      const { index } = findBestTrackAnchorShape(history, trackAnchorIndex, searchRadius);
      
      // Hysteresis / Threshold
      // Only switch if this match is reasonably good?
      // Or just switch. Since looking back 2 mins is very stable, 
      // the error minimum should be robust.
      
      if (index !== trackAnchorIndex) {
          setTrackAnchorIndex(index);
          const anchorT = thunderhillData.configurations[0].trackPath[index];
          // We align Current User Pos to Anchor Track Pos
          // This implies VirtualStart must be adjusted so that:
          // User(Now) + Offset = Anchor(Now)
          // VirtualStart is basically measuring the offset.
          // Correct Logic: VirtualStart = UserPos - (AnchorPosWorld / Scale)?
          // Simpler: Just set VirtualStart Lat/Lon such that User Lat/Lon maps to Anchor Lat/Lon (roughly).
          // Actually, our projection logic is:
          // dLat = User.lat - VirtualStart.lat
          // World = TrackStart + dLat
          // We want World to equal AnchorWorld.
          // AnchorWorld = TrackStart + (Anchor - TrackStart).
          // So dLat should equal (Anchor - TrackStart).
          // User.lat - VS.lat = Anchor.lat - TrackStart.lat
          // VS.lat = User.lat - (Anchor.lat - TrackStart.lat)
          // VS.lat = User.lat - Anchor.lat + TrackStart.lat
          
          const trackStart = thunderhillData.configurations[0].trackPath[0];
          setVirtualStart({
              lat: f.latitude - anchorT[0] + trackStart[0],
              lon: f.longitude - anchorT[1] + trackStart[1],
              alt: f.altitude
          });
      }
      
      lastAlignTime.current = now;

  }, [data, trackAnchorIndex, findBestTrackAnchorShape, sessionStartTime]);

  // Initialize Virtual Start when data first arrives (Run ONCE)
  useEffect(() => {
    if (!virtualStart && data && data.length > 5) {
       // Use substantial history if available, or just the first few seconds
       // If we just loaded a file, we have lots of data. If live, we might have 5 frames.
       // Let's take up to 30 frames.
       const history = data.slice(0, Math.min(data.length, 30));
       
       const { index } = findBestTrackAnchorShape(history, 0, -1); // Global search
       
       setTrackAnchorIndex(index);
       const anchorT = thunderhillData.configurations[0].trackPath[index];
       
       // Calc Virtual Start based on Anchor
       // VS = User(0) - Anchor + TrackStart
       // Wait, User(0) corresponds to History[0]. 
       // In findBestTrackAnchorShape, we align LatestHistory to Anchor.
       // So User[Latest] maps to Anchor.
       // VS = User[Latest] - Anchor + TrackStart
       
       const latestInHistory = history[history.length-1];
       const trackStart = thunderhillData.configurations[0].trackPath[0];
       
       setVirtualStart({
           lat: latestInHistory.latitude - anchorT[0] + trackStart[0],
           lon: latestInHistory.longitude - anchorT[1] + trackStart[1],
           alt: latestInHistory.altitude
       });
    }
  }, [virtualStart, data, findBestTrackAnchorShape]);

  // Force reset handler
  const resetAlignment = useCallback(() => {
      if (data && data.length > 5) { 
          // Use recent history for shape matching
          const lookbackParam = 100; // 10s lookback for reset
          const startIdx = Math.max(0, data.length - lookbackParam);
          const history = data.slice(startIdx);
          
          const { index } = findBestTrackAnchorShape(history, 0, -1); // Global search
          
          setTrackAnchorIndex(index);
          const anchorT = thunderhillData.configurations[0].trackPath[index];
          const trackStart = thunderhillData.configurations[0].trackPath[0];
          const latest = data[data.length-1];

          setVirtualStart({
              lat: latest.latitude - anchorT[0] + trackStart[0],
              lon: latest.longitude - anchorT[1] + trackStart[1],
              alt: latest.altitude
          });
          
          setManualShiftX(0);
          setManualShiftZ(0);
      }
  }, [data, findBestTrackAnchorShape]);

  // Calculate projection parameters - ALWAYS use Thunderhill as reference
  const projectionParams = useMemo(() => {
     // Default Reference (Thunderhill)
     const defaultReference = thunderhillData.configurations[0].trackPath;
     
     // Calculate center from default track
     if (defaultReference && defaultReference.length > 0) {
          let minLat = Infinity, maxLat = -Infinity;
          let minLon = Infinity, maxLon = -Infinity;
          
          defaultReference.forEach(p => {
              const lat = p[0];
              const lon = p[1];
              minLat = Math.min(minLat, lat);
              maxLat = Math.max(maxLat, lat);
              minLon = Math.min(minLon, lon);
              maxLon = Math.max(maxLon, lon);
          });
          
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          const centerAlt = 0; 
          
          const latScale = 111132; 
          const lonScale = 111132 * Math.cos(centerLat * Math.PI / 180);
          
          return { centerLat, centerLon, centerAlt, latScale, lonScale };
     }
     return null;
  }, []); // Stable projection

  const trackPositions = useMemo(() => {
    if (!data || data.length === 0 || !projectionParams || !virtualStart) return new Float32Array(0);

    const { centerLat, centerLon, latScale: trackLatScale, lonScale: trackLonScale } = projectionParams;
    
    // Virtual Anchor Point on Track (Dynamic now!)
    const trackPath = thunderhillData.configurations[0].trackPath;
    const trackStart = trackPath[trackAnchorIndex] || trackPath[0];
    
    const trackStartLat = trackStart[0];
    const trackStartLon = trackStart[1];

    // Calculate Track Anchor position in World Coordinates (relative to center)
    const trackStartX = (trackStartLon - centerLon) * trackLonScale;
    const trackStartZ = -(trackStartLat - centerLat) * trackLatScale;

    // User's Local Projection Scales
    const userLatScale = 111132; 
    const userLonScale = 111132 * Math.cos(virtualStart.lat * Math.PI / 180);

    const MAX_DISTANCE = 2000000; 
    const pos = new Float32Array(data.length * 3);
    
    // Rotation Math
    const rad = pathRotation * (Math.PI / 180);
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    let lastX = 0;
    let lastY = 0;
    let lastZ = 0;
    let hasValid = false;

    data.forEach((f, i) => {
      // 1. Calculate delta in METERS from User's Virtual Start
      // North is +Lat. East is +Lon.
      const dLatMeters = (f.latitude - virtualStart.lat) * userLatScale; // North+
      const dLonMeters = (f.longitude - virtualStart.lon) * userLonScale; // East+

      // 2. Rotate this delta vector
      // Standard 2D rotation: x' = xcos - ysin, y' = xsin + ycos
      // Here X is East (Lon), Y is "North" (Lat). 
      // So rotX = dLon*cos - dLat*sin
      //    rotY = dLon*sin + dLat*cos
      const rotLonMeters = dLonMeters * cosR - dLatMeters * sinR;
      const rotLatMeters = dLonMeters * sinR + dLatMeters * cosR;

      // 3. Apply to Track Start AND Manual Shifts
      // World X = TrackStartX + rotLonMeters + ManualX
      // World Z = TrackStartZ - rotLatMeters + ManualZ (Inverted Z for North)
      // Note: ManualZ is usually "Up" on the screen in 2D map. 
      // In 3D: X is Right, Z is Back (towards camera/bottom). -Z is Forward/Up.
      // So if we want to move "Up" on screen, we need more negative Z.
      // If the slider is "Z Shift", user probably thinks "Up/Down".
      // Let's make +Z slider move "Up" on map (more negative Z world).
      // Wait, standard map control: 
      // X: Right (+), Left (-)
      // Y (Screen): Up (+), Down (-) -> 3D Z: Up (-), Down (+)
      // So ManualZ should be subtracted likely? Or just added and user figures it out.
      // Let's just add it directly to coordinate logic.
      // Standard: +Z is "Down" on 2D map (South). -Z is "Up" (North).
      
      let x = trackStartX + rotLonMeters + manualShiftX;
      // Force altitude to be relative to track surface (0), ignoring absolute GPS altitude diff
      // But preserve relative altitude changes?
      // For now, let's flatline it to 0 or preserve relative change from start
      let y = (f.altitude - virtualStart.alt) * 5; 
      let z = trackStartZ - rotLatMeters + manualShiftZ; 
      
      const isValid = Math.abs(x) < MAX_DISTANCE && Math.abs(z) < MAX_DISTANCE && !isNaN(x) && !isNaN(z);
      
      if (isValid) {
          lastX = x;
          lastY = y;
          lastZ = z;
          hasValid = true;
      } else if (hasValid) {
          x = lastX;
          y = lastY;
          z = lastZ;
      } else {
          x = 0;
          y = 0;
          z = 0;
      }

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    });
    
    return pos;
  }, [data, projectionParams, virtualStart, pathRotation, manualShiftX, manualShiftZ, trackAnchorIndex]);

  // Pre-calculate Static Map Positions
  const staticMapPositions = useMemo(() => {
      if (!projectionParams) return null;
      const refPath = thunderhillData.configurations[0].trackPath;
      if (!refPath || refPath.length === 0) return null;

      const { centerLat, centerLon, centerAlt, latScale, lonScale } = projectionParams;
      const pos = new Float32Array(refPath.length * 3);

      refPath.forEach((p, i) => {
          const lat = p[0];
          const lon = p[1];
          const alt = 0; 
          
          pos[i * 3] = (lon - centerLon) * lonScale;
          pos[i * 3 + 1] = (alt - centerAlt) * 5; 
          pos[i * 3 + 2] = -(lat - centerLat) * latScale;
      });
      return pos;
  }, [projectionParams]);
  
  // Calculate Sectors
  const sectorMarkers = useMemo(() => {
    if (!projectionParams) return [];
    const sectors = thunderhillData.configurations[0].sectors;
    if (!sectors) return [];

    const { centerLat, centerLon, latScale, lonScale } = projectionParams;
    
    return sectors.map(s => {
        if (!s.coordinates) return null;
        const x = (s.coordinates.longitude - centerLon) * lonScale;
        const z = -(s.coordinates.latitude - centerLat) * latScale;
        return { id: s.id, name: s.name, x, z };
    }).filter((s): s is { id: string; name: string; x: number; z: number } => s !== null);
  }, [projectionParams]);

  // Calculate Ghost Position
  const ghostFrame = useMemo((): TelemetryFrame | null => getGhostFrame(), [getGhostFrame]);
  
  const ghostPosition = useMemo(() => {
    if (!ghostFrame || !projectionParams) return null;
    const { centerLat, centerLon, latScale, lonScale } = projectionParams;
    const x = (ghostFrame.longitude - centerLon) * lonScale;
    const z = -(ghostFrame.latitude - centerLat) * latScale; // Negate Z for correct orientation
    return [x, 0.5, z] as [number, number, number]; 
  }, [ghostFrame, projectionParams]);

  const startLinePos = useMemo(() => {
      if (!laps.length || !projectionParams) return null;
      const startFrame = laps[0].frames[0];
      const { centerLat, centerLon, latScale, lonScale } = projectionParams;
      const x = (startFrame.longitude - centerLon) * lonScale;
      const z = -(startFrame.latitude - centerLat) * latScale;
      return [x, 0, z] as [number, number, number];
  }, [laps, projectionParams]);


  const getHistory = useMemo(() => {
    return () => {
      if (!currentFrame) return [];
      return data.filter(f => f.time <= currentFrame.time && f.time > currentFrame.time - 60);
    };
  }, [data, currentFrame]);


  // Drag Handling
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newSplit = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    setSplitPosition(Math.min(Math.max(newSplit, 20), 80));
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);


  // Non-blocking loading/error state
  // content continues below

  const activeViews = [showPitView, showDriverView, showCoachView].filter(Boolean).length;

  return (
    <div className="h-full w-full bg-black text-white flex flex-col overflow-hidden font-sans selection:bg-red-500/30">
      
      {/* Header */}
      <header className="h-14 border-b border-gray-800 bg-gray-900/50 backdrop-blur flex items-center justify-between px-4 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-red-500">
            <Radio size={20} className="animate-pulse" />
            <span className="font-bold tracking-tight">RACE<span className="text-white">LIVE</span></span>
          </div>
          
          <div className="h-6 w-px bg-gray-800 mx-2" />
          
          <div className="flex items-center bg-gray-800 rounded-lg p-1 gap-1">
            <button
              onClick={() => setShowPitView(!showPitView)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showPitView ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Pit Wall
            </button>
            <button
              onClick={() => setShowDriverView(!showDriverView)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showDriverView ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Driver Cam
            </button>
            <button
              onClick={() => setShowCoachView(!showCoachView)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showCoachView ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Coach
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700">
                <span className="text-gray-500 text-xs">SOURCE</span>
                <input 
                    type="text" 
                    value={sourceUrl || ''} 
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="bg-transparent border-none text-xs text-white w-48 focus:outline-none"
                    placeholder="Telemetry URL"
                />
            </div>



            {/* Connection Status Indicator */}
             <div 
                onClick={toggleLive}
                className={`flex items-center gap-2 px-3 py-1 rounded border cursor-pointer hover:opacity-80 transition-opacity ${
                error ? 'bg-red-900/20 border-red-500/30 text-red-500' :
                loading ? 'bg-yellow-900/20 border-yellow-500/30 text-yellow-500' :
                isLive ? 'bg-green-900/20 border-green-500/30 text-green-500' :
                'bg-gray-800 border-gray-700 text-gray-500'
            }`}>
                <div className={`w-2 h-2 rounded-full ${
                    error ? 'bg-red-500' :
                    loading ? 'bg-yellow-500 animate-pulse' :
                    isLive ? 'bg-green-500 animate-pulse' :
                    'bg-gray-500'
                }`} />
                <span className="text-xs font-bold tracking-wider">
                    {error ? 'ERROR' : loading ? 'CONNECTING' : isLive ? 'LIVE' : 'GO LIVE'}
                </span>
            </div>

            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700">
                <span className="text-gray-500 text-xs">TRACK</span>
                <select 
                    value={selectedTrackId} 
                    onChange={(e) => setSelectedTrackId(e.target.value)}
                    className="bg-transparent border-none text-xs text-white focus:outline-none cursor-pointer"
                >
                    <option value="thunderhill_east">Thunderhill East</option>
                </select>
            </div>

            {/* ALIGNMENT CONTROLS */}
            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700">
                <span className="text-gray-500 text-xs">ALIGN</span>
                {/* Rotation */}
                <input 
                    type="range" 
                    min="-180" 
                    max="180" 
                    value={pathRotation} 
                    onChange={(e) => setPathRotation(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    title="Rotation"
                />
                
                {/* X Shift */}
                <span className="text-gray-500 text-[10px] ml-1">X</span>
                <input 
                    type="range" 
                    min="-500" 
                    max="500" 
                    step="10"
                    value={manualShiftX} 
                    onChange={(e) => setManualShiftX(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    title="Shift X (East/West)"
                />

                 {/* Z Shift */}
                 <span className="text-gray-500 text-[10px] ml-1">Z</span>
                 <input 
                    type="range" 
                    min="-500" 
                    max="500" 
                    step="10"
                    value={manualShiftZ} 
                    onChange={(e) => setManualShiftZ(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    title="Shift Z (North/South)"
                />

                <button 
                  onClick={resetAlignment}
                  className="ml-2 p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                  title="Reset Alignment Origin"
                >
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" /></svg>
                </button>
            </div>

            {idealLap && (
                <div className="flex items-center gap-2 bg-gray-800/50 px-3 py-1 rounded border border-gray-700">
                    <Trophy size={14} className="text-yellow-500" />
                    <span className="text-xs text-gray-400">Best Lap:</span>
                    <span className="text-sm font-mono font-bold text-yellow-400">{idealLap.lapTime.toFixed(3)}s</span>
                </div>
            )}
            

        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow p-4 flex gap-4 overflow-hidden" ref={containerRef}>
        
        {/* Pit View */}
        {showPitView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: activeViews === 1 ? '100%' : (activeViews === 2 && showDriverView && !showCoachView ? `${splitPosition}%` : `${100/activeViews}%`),
              flex: (activeViews === 2 && showDriverView && !showCoachView) ? 'none' : '1'
            }}
          >
            <PitView 
              currentFrame={currentFrame} 
              trackPositions={trackPositions} 
              currentIndex={currentIndex}
              getHistory={getHistory}
              ghostFrame={ghostFrame}
              ghostPosition={ghostPosition}
              showGhost={showGhost}
              idealLap={idealLap}
              laps={laps}
              gpsOnly={true}
              staticMapPositions={staticMapPositions}
              sectorMarkers={sectorMarkers}
              rotation={mapRotation}
            />
          </div>
        )}

        {/* Resizer */}
        {showPitView && showDriverView && !showCoachView && (
          <div
            className="w-1 bg-gray-800 hover:bg-blue-500 cursor-col-resize flex items-center justify-center transition-colors group z-10"
            onMouseDown={startResizing}
          >
            <div className="h-8 w-1 bg-gray-600 group-hover:bg-white rounded-full" />
          </div>
        )}

        {/* Driver View */}
        {showDriverView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: activeViews === 1 ? '100%' : (activeViews === 2 && showPitView && !showCoachView ? `${100 - splitPosition}%` : `${100/activeViews}%`),
              flex: (activeViews === 2 && showPitView && !showCoachView) ? 'none' : '1'
            }}
          >
            <div className="flex-grow relative h-full flex flex-col">
                <DriverView 
                    positions={trackPositions} 
                    currentIndex={currentIndex} 
                    currentFrame={currentFrame}
                    ghostFrame={ghostFrame}
                    ghostPosition={ghostPosition}
                    showGhost={showGhost}
                    setShowGhost={setShowGhost}
                    startLinePos={startLinePos}
                    gpsOnly={true}
                    staticMapPositions={staticMapPositions}
                    sectorMarkers={sectorMarkers}
                    rotation={mapRotation}
                />
            </div>
          </div>
        )}

        {/* Coach View */}
        {showCoachView && (
             <div 
                className="flex flex-col min-w-0 overflow-hidden"
                style={{ 
                  width: activeViews === 1 ? '100%' : `${100/activeViews}%`,
                  flex: '1'
                }}
              >
                <PerformanceCoach 
                    currentFrame={currentFrame}
                    ghostFrame={ghostFrame}
                    idealLap={idealLap}
                    currentIndex={currentIndex}
                    laps={laps}
                    gpsOnly={true}
                />
              </div>
        )}
      </main>

      <footer className="bg-gray-900 border-t border-gray-800 p-4">
        <div className="flex justify-between items-center">
             <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="font-mono text-red-500">LIVE</span>
                <span>{currentFrame?.time?.toFixed(2) ?? '0.00'}s</span>
             </div>

             <div className="flex items-center gap-4">
                 <button 
                  onClick={toggleLive}
                  className={`p-3 rounded-full transition shadow-lg ${isLive ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20' : 'bg-green-600 hover:bg-green-700'}`}
                  title={isLive ? "Pause Live Feed" : "Resume Live Feed"}
                >
                  {isLive ? <Pause size={24} /> : <Play size={24} />}
                </button>
             </div>


        </div>
      </footer>
    </div>
  );
}
