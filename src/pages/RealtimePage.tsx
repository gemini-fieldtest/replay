import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRealtimeTelemetry } from '../hooks/useRealtimeTelemetry';
import { Play, Pause, Activity, Trophy, Radio, LayoutDashboard } from 'lucide-react';
import { LiveVideoPlayer } from '../components/LiveVideoPlayer';
import { RealtimePitView } from './RealtimePitView';
import { PerformanceCoach } from './PerformanceCoach';



export const RealtimePage = () => {
  // Default to localhost telemetry server
  const [sourceUrl, setSourceUrl] = useState<string | null>('http://localhost:8000/events');
  const [videoUrl, setVideoUrl] = useState<string>(''); // Default empty for now
  
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
    fullTrackBuffer // Use this for stable map projection
  } = useRealtimeTelemetry(sourceUrl);

  const [showGhost] = useState(true);

  // Calculate projection parameters from the FULL TRACK BUFFER (stable coordinates)
  const projectionParams = useMemo(() => {
    // If we have full track buffer, use it. Otherwise fallback to data (which might be growing)
    const sourceData = (fullTrackBuffer && fullTrackBuffer.length > 0) ? fullTrackBuffer : data;
    
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
  }, [fullTrackBuffer, data]); // specific dependency on fullTrackBuffer

  const trackPositions = useMemo(() => {
    if (!data || data.length === 0 || !projectionParams) return new Float32Array(0);

    const { centerLat, centerLon, centerAlt, latScale, lonScale } = projectionParams;

    const pos = new Float32Array(data.length * 3);
    
    data.forEach((f, i) => {
      pos[i * 3] = (f.longitude - centerLon) * lonScale;
      pos[i * 3 + 1] = (f.altitude - centerAlt) * 5; // Y is up
      pos[i * 3 + 2] = -(f.latitude - centerLat) * latScale; // Z is forward/back
    });
    
    return pos;
  }, [data, projectionParams]);

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


  if (loading && !data.length) return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white gap-4">
          <Activity className="animate-pulse text-red-500" size={48} />
          <div className="text-xl font-mono">Connecting to Live Feed...</div>
      </div>
  );
  
  if (error) return <div className="flex items-center justify-center h-screen bg-gray-900 text-red-500">Error: {error.message}</div>;

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
            <Link to="/replay" className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
                <LayoutDashboard size={14} />
                <span>Replay</span>
            </Link>
            <div className="w-px h-4 bg-gray-700 mx-1" />
            
             <button 
                  onClick={toggleLive}
                  className={`p-1.5 rounded-full transition shadow-lg ${isLive ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20' : 'bg-green-600 hover:bg-green-700'}`}
                  title={isLive ? "Pause Live Feed" : "Resume Live Feed"}
                >
                  {isLive ? <Pause size={14} /> : <Play size={14} />}
            </button>
                 <div className="flex items-center gap-2 text-gray-400 text-xs font-mono w-16 justify-end tabular-nums">
                    <span className={isLive ? "text-red-500" : "text-gray-500"}>{currentFrame?.time?.toFixed(2) ?? '0.00'}s</span>
                 </div>

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

            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700">
                <span className="text-gray-500 text-xs">VIDEO</span>
                <input 
                    type="file" 
                    accept="video/*"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            setVideoUrl(URL.createObjectURL(file));
                        }
                    }}
                    className="bg-transparent border-none text-xs text-white w-48 focus:outline-none file:mr-2 file:py-0 file:px-2 file:rounded file:border-0 file:text-xs file:font-medium file:bg-gray-700 file:text-white hover:file:bg-gray-600"
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
            <RealtimePitView 
              currentFrame={currentFrame} 
              trackPositions={trackPositions} 
              currentIndex={currentIndex}
              ghostFrame={ghostFrame}
              ghostPosition={ghostPosition}
              showGhost={showGhost}
              idealLap={idealLap}
              laps={laps}
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
                <LiveVideoPlayer 
                    streamUrl={videoUrl}
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
                />
              </div>
        )}
      </main>


    </div>
  );
}
