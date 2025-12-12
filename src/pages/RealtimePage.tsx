import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRealtimeTelemetry } from '../hooks/useRealtimeTelemetry';
import { 
  Trophy, LayoutGrid, Rows,
  Gauge, Flag, Map, CarFront, Headset, Sparkles // Racing Icons
} from 'lucide-react';
import { LiveVideoPlayer } from '../components/LiveVideoPlayer';
import { RealtimePitView } from './RealtimePitView';
import { RealtimeCoach } from './RealtimeCoach';
import { loadKML, type GeoCoordinate } from '../utils/kmlLoader';
import { useTheme } from '../components/ThemeProvider';




export const RealtimePage = () => {
  // Default to localhost telemetry server
  const [sourceUrl, setSourceUrl] = useState<string | null>('http://localhost:8000/events');
  const [videoUrl, setVideoUrl] = useState<string>(''); // Default empty for now
  
  const { theme, toggleTheme } = useTheme();

  const [layoutMode, setLayoutMode] = useState<'grid' | 'stacked'>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode') as 'grid' | 'stacked';
    if (urlMode) return urlMode;
    return (localStorage.getItem('realtime_layout_mode') as 'grid' | 'stacked') || 'grid';
  });

  // Layout State - Force defaults if loaded in stacked mode
  const [showPitView, setShowPitView] = useState(true);
  const [showDriverView, setShowDriverView] = useState(true);
  const [showCoachView, setShowCoachView] = useState(true);
  
  const [splitPosition, setSplitPosition] = useState(50); // Percentage for the split
  const [isResizing, setIsResizing] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  const [showGhost] = useState(true);
  const [kmlTrack, setKmlTrack] = useState<GeoCoordinate[]>([]);
  const [trackPoints, setTrackPoints] = useState<any[]>([]);
  const [startLine, setStartLine] = useState<{ lat: number, lon: number } | undefined>(undefined);

  const { 
    data,
    loading, 
    error, 
    currentFrame, 
    currentIndex, 

    idealLap,
    laps,
    getGhostFrame,
    fullTrackBuffer // Use this for stable map projection
  } = useRealtimeTelemetry(sourceUrl, startLine);

  useEffect(() => {
    const fetchTrackData = async () => {
      // Load KML
      const coords = await loadKML('/tracks/thunderhill/track.kml');
      if (coords.length > 0) {
        setKmlTrack(coords);
      }
      
      // Load Points for Start/Finish
      try {
        const response = await fetch('/tracks/thunderhill/points.json');
        if (response.ok) {
            const points = await response.json();
            setTrackPoints(points);
            const startPoint = points.find((p: any) => p.name === 'start');
            if (startPoint) {
                setStartLine({ lat: startPoint.lat, lon: startPoint.long });
            }
        }
      } catch (e) {
        console.error("Failed to load points.json", e);
      }
    };
    fetchTrackData();
  }, []);

  // Calculate projection parameters from the FULL TRACK BUFFER (stable coordinates) or KML
  const projectionParams = useMemo(() => {
    // If we have KML track, use it (Most stable). Otherwise fallback to fullTrackBuffer or data.
    const sourceData = (kmlTrack.length > 0) ? kmlTrack : (fullTrackBuffer && fullTrackBuffer.length > 0) ? fullTrackBuffer : data;
    
    if (!sourceData || sourceData.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    let minAlt = Infinity, maxAlt = -Infinity;

    sourceData.forEach(f => {
      minLat = Math.min(minLat, f.latitude);
      maxLat = Math.max(maxLat, f.latitude);
      minLon = Math.min(minLon, f.longitude);
      maxLon = Math.max(maxLon, f.longitude);
      minAlt = Math.min(minAlt, f.altitude);
      maxAlt = Math.max(maxAlt, f.altitude);
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const centerAlt = (minAlt + maxAlt) / 2;

    // Convert to local coordinates (meters approx)
    const latScale = 111000;
    const lonScale = 111000 * Math.cos(centerLat * Math.PI / 180);

    return { centerLat, centerLon, centerAlt, latScale, lonScale };
  }, [fullTrackBuffer, data, kmlTrack]); 

  const trackPositions = useMemo(() => {
    const sourceData = (kmlTrack.length > 0) ? kmlTrack : data;
    if (!sourceData || sourceData.length === 0 || !projectionParams) return new Float32Array(0);

    const { centerLat, centerLon, centerAlt, latScale, lonScale } = projectionParams;

    const pos = new Float32Array(sourceData.length * 3);
    
    sourceData.forEach((f, i) => {
      pos[i * 3] = (f.longitude - centerLon) * lonScale;
      pos[i * 3 + 1] = (f.altitude - centerAlt) * 5; // Y is up
      pos[i * 3 + 2] = -(f.latitude - centerLat) * latScale; // Z is forward/back
    });
    
    return pos;
  }, [data, projectionParams, kmlTrack]);

  const carPosition = useMemo(() => {
    if (!currentFrame || !projectionParams) return null;
    const { centerLat, centerLon, latScale, lonScale } = projectionParams;
    const x = (currentFrame.longitude - centerLon) * lonScale;
    const z = -(currentFrame.latitude - centerLat) * latScale; // Negate Z for correct orientation
    // We can just use a fixed height or logic for Y
    return [x, 0.5, z] as [number, number, number]; 
  }, [currentFrame, projectionParams]);

  // Calculate Ghost Position
  const ghostFrame = useMemo(() => getGhostFrame(), [getGhostFrame]);
  
  const ghostPosition = useMemo(() => {
    if (!ghostFrame || !projectionParams) return null;
    const { centerLat, centerLon, latScale, lonScale } = projectionParams;
    const x = (ghostFrame.longitude - centerLon) * lonScale;
    const z = -(ghostFrame.latitude - centerLat) * latScale; // Negate Z for correct orientation
    return [x, 0.5, z] as [number, number, number]; 
  }, [ghostFrame, projectionParams]);



  /* Removed getHistory memo as it is no longer used */

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
  
  const toggleLayoutMode = (mode: 'grid' | 'stacked') => {
    localStorage.setItem('realtime_layout_mode', mode);
    const params = new URLSearchParams(window.location.search);
    params.set('mode', mode);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    setLayoutMode(mode);
    if (mode === 'stacked') {
        setShowPitView(true);
        setShowDriverView(true);
        setShowCoachView(true);
    }
  };



  
  // if (error) return <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900 text-red-500">Error: {error.message}</div>;

  const activeViews = [showPitView, showDriverView, showCoachView].filter(Boolean).length;
  const isStacked = layoutMode === 'stacked';

  return (
    <div className="h-full w-full bg-white dark:bg-black text-gray-900 dark:text-white flex flex-col overflow-hidden font-sans selection:bg-red-500/30">
      
      {/* Header */}
      <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur flex items-center justify-between px-4 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleTheme}
            className="flex items-center gap-2 text-green-600 dark:text-green-500 hover:scale-105 transition-transform cursor-pointer"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            <Sparkles size={20} />
            <span className="font-bold tracking-tight text-xl italic font-mono">
              KORU<span className="text-gray-900 dark:text-white">CIRCUIT</span>
              <span className="text-xs ml-1 not-italic font-sans bg-yellow-400 text-black px-1.5 py-0.5 rounded font-bold">VIK</span>
            </span>
          </button>
          
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />
          
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
            <div title="Live Telemetry" className="flex items-center justify-center p-1.5 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent cursor-default">
                <Gauge size={16} />
            </div>
            <Link to="/replay" title="Replay Analysis" className="flex items-center justify-center p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50 transition-colors">
                <Flag size={16} />
            </Link>
          </div>

          { !isStacked && (
            <>
              <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-1" />
              
              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-0.5">
                <button
                  onClick={() => setShowPitView(!showPitView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    showPitView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
                  }`}
                >
                  <Map size={14} />
                  Pit
                </button>
                <button
                  onClick={() => setShowDriverView(!showDriverView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    showDriverView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
                  }`}
                >
                  <CarFront size={14} />
                  Driver
                </button>
                <button
                  onClick={() => setShowCoachView(!showCoachView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    showCoachView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
                  }`}
                >
                  <Headset size={14} />
                  Coach
                </button>
              </div>
            </>
          )}
          
           <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />

           {/* Layout Toggle */}
           <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
              <button
                onClick={() => toggleLayoutMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${layoutMode === 'grid' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'}`}
                title="Grid View"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => toggleLayoutMode('stacked')}
                className={`p-1.5 rounded-md transition-colors ${layoutMode === 'stacked' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'}`}
                title="Stacked View"
              >
               <Rows size={14} /> 
              </button>
           </div>
        </div>

        <div className="flex items-center gap-6">


            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 border border-gray-200 dark:border-gray-700">
                <span className="text-gray-500 text-xs">SOURCE</span>
                <input 
                    type="text" 
                    name="telemetryUrl"
                    autoComplete="off"
                    spellCheck="false"
                    value={sourceUrl || ''} 
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="bg-transparent border-none text-xs text-gray-900 dark:text-white w-48 focus:outline-none"
                    placeholder="Telemetry URL"
                />
            </div>





            {error ? (
                <div title={error.message} className="flex items-center gap-2 px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-500">
                     <div className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-500 animate-pulse" />
                    <span className="text-xs font-bold tracking-wider">OFFLINE</span>
                </div>
            ) : loading && !data.length ? (
                <div className="flex items-center gap-2 px-3 py-1 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-500">
                    <div className="w-2 h-2 rounded-full bg-yellow-600 dark:bg-yellow-500 animate-pulse" />
                    <span className="text-xs font-bold tracking-wider">CONNECTING</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-500">
                    <div className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-500 animate-pulse" />
                    <span className="text-xs font-bold tracking-wider">LIVE</span>
                </div>
            )}

            {idealLap && (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 px-3 py-1 rounded border border-gray-200 dark:border-gray-700">
                    <Trophy size={14} className="text-yellow-600 dark:text-yellow-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">Best Lap:</span>
                    <span className="text-sm font-mono font-bold text-yellow-600 dark:text-yellow-400">{idealLap.lapTime.toFixed(3)}s</span>
                </div>
            )}
            

        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-grow p-4 flex gap-4 ${isStacked ? 'flex-col overflow-y-auto' : 'overflow-hidden'}`} ref={containerRef}>
        
        {/* Pit View */}
        {showPitView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: isStacked ? '100%' : (activeViews === 1 ? '100%' : (activeViews === 2 && showDriverView && !showCoachView ? `${splitPosition}%` : `${100/activeViews}%`)),
              flex: isStacked ? 'none' : ((activeViews === 2 && showDriverView && !showCoachView) ? 'none' : '1'),
              height: isStacked ? '70vh' : 'auto'
            }}
          >
            <RealtimePitView 
              currentFrame={currentFrame} 
              positions={trackPositions} 
              currentIndex={currentIndex}
              carPosition={carPosition}
              ghostFrame={ghostFrame}
              ghostPosition={ghostPosition}
              showGhost={showGhost}
              idealLap={idealLap}
              laps={laps}
            />
          </div>
        )}

        {/* Resizer */}
        {!isStacked && showPitView && showDriverView && !showCoachView && (
          <div
            className="w-1 bg-gray-200 dark:bg-gray-800 hover:bg-blue-500 cursor-col-resize flex items-center justify-center transition-colors group z-10"
            onMouseDown={startResizing}
          >
            <div className="h-8 w-1 bg-gray-400 dark:bg-gray-600 group-hover:bg-white rounded-full" />
          </div>
        )}

        {/* Driver View */}
        {showDriverView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: isStacked ? '100%' : (activeViews === 1 ? '100%' : (activeViews === 2 && showPitView && !showCoachView ? `${100 - splitPosition}%` : `${100/activeViews}%`)),
              flex: isStacked ? 'none' : ((activeViews === 2 && showPitView && !showCoachView) ? 'none' : '1'),
              height: isStacked ? '70vh' : 'auto'
            }}
          >
            <div className="flex-grow relative h-full flex flex-col">
                <LiveVideoPlayer 
                    streamUrl={videoUrl}
                    onVideoSelect={(file) => setVideoUrl(URL.createObjectURL(file))}
                />
            </div>
          </div>
        )}

        {/* Coach View */}
        {showCoachView && (
             <div 
                className="flex flex-col min-w-0 overflow-hidden"
                style={{ 
                  width: isStacked ? '100%' : (activeViews === 1 ? '100%' : `${100/activeViews}%`),
                  flex: isStacked ? 'none' : '1',
                  height: isStacked ? '70vh' : 'auto'
                }}
              >
                <RealtimeCoach 
                    currentFrame={currentFrame}
                    ghostFrame={ghostFrame}
                    idealLap={idealLap}
                    currentIndex={currentIndex}
                    laps={laps}
                    trackPoints={trackPoints}
                />
              </div>
        )}
      </main>


    </div>
  );
}
