import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRealtimeTelemetry } from '../hooks/useRealtimeTelemetry';
import { Activity, Trophy, LayoutDashboard, GalleryVerticalEnd } from 'lucide-react';
import { LiveVideoPlayer } from '../components/LiveVideoPlayer';
import { RealtimePitView } from './RealtimePitView';
import { RealtimeCoach } from './RealtimeCoach';
import { loadKML, type GeoCoordinate } from '../utils/kmlLoader';



export const RealtimePage = () => {
  // Default to localhost telemetry server
  const [sourceUrl, setSourceUrl] = useState<string | null>('http://localhost:8000/events');
  const [videoUrl, setVideoUrl] = useState<string>(''); // Default empty for now
  
  const [layoutMode, setLayoutMode] = useState<'grid' | 'stacked'>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('mode') as 'grid' | 'stacked') || 'stacked';
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


  if (loading && !data.length) return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white gap-4">
          <Activity className="animate-pulse text-red-500" size={48} />
          <div className="text-xl font-mono">Connecting to Live Feed...</div>
      </div>
  );
  
  if (error) return <div className="flex items-center justify-center h-screen bg-gray-900 text-red-500">Error: {error.message}</div>;

  const activeViews = [showPitView, showDriverView, showCoachView].filter(Boolean).length;
  const isStacked = layoutMode === 'stacked';

  return (
    <div className="h-full w-full bg-black text-white flex flex-col overflow-hidden font-sans selection:bg-red-500/30">
      
      {/* Header */}
      <header className="h-14 border-b border-gray-800 bg-gray-900/50 backdrop-blur flex items-center justify-between px-4 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-red-500">
            {isStacked ? <GalleryVerticalEnd size={20} className="animate-pulse" /> : <LayoutDashboard size={20} />}
            <span className="font-bold tracking-tight">RACE<span className="text-white">LIVE</span></span>
          </div>
          
          <div className="h-6 w-px bg-gray-800 mx-2" />
          
          <div className="flex items-center bg-gray-800 rounded-lg p-1 gap-1">
            <Link to="/replay" className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
                <LayoutDashboard size={14} />
                <span>Replay</span>
            </Link>
            <div className="w-px h-4 bg-gray-700 mx-1" />

            { !isStacked && (
              <>
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
              </>
            )}
          </div>
          
           <div className="h-6 w-px bg-gray-800 mx-2" />

           {/* Layout Toggle */}
           <div className="flex items-center bg-gray-800 rounded-lg p-1 gap-1">
              <button
                onClick={() => toggleLayoutMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${!isStacked ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                title="Grid View"
              >
                <LayoutDashboard size={14} />
              </button>
              <button
                onClick={() => toggleLayoutMode('stacked')}
                className={`p-1.5 rounded-md transition-colors ${isStacked ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                title="Stacked View"
              >
               <GalleryVerticalEnd size={14} /> 
              </button>
           </div>
        </div>

        <div className="flex items-center gap-6">


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





            <div className="flex items-center gap-2 px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-500">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-bold tracking-wider">LIVE</span>
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
                />
              </div>
        )}
      </main>


    </div>
  );
}
