import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import { Play, Pause, SkipForward, SkipBack, FileText, Upload, LayoutDashboard, RotateCcw, Repeat, Trophy } from 'lucide-react';
import { PitView } from './pages/PitView';
import { DriverView } from './pages/DriverView';
import { PerformanceCoach } from './pages/PerformanceCoach';

interface ManifestFile {
  name: string;
  url: string;
  lastModified: number;
  size: number;
}

function App() {
  const [manifest, setManifest] = useState<ManifestFile[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | File | null>(null);
  
  // Layout State
  const [showPitView, setShowPitView] = useState(true);
  const [showDriverView, setShowDriverView] = useState(true);
  const [showCoachView, setShowCoachView] = useState(true);
  const [splitPosition, setSplitPosition] = useState(50); // Percentage
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load manifest
  useEffect(() => {
    fetch('/manifest.json')
      .then(res => res.json())
      .then((files: ManifestFile[]) => {
        setManifest(files);
        if (files.length > 0) {
          // Default to most recent file (already sorted by script)
          setSelectedSource(files[0].url);
        }
      })
      .catch(err => console.error('Failed to load manifest:', err));
  }, []);

  const { 
    loading, 
    error, 
    currentFrame, 
    isPlaying, 
    togglePlay, 
    seek, 
    currentIndex, 
    data,
    playbackSpeed,
    setPlaybackSpeed,
    isLooping,
    setIsLooping,
    idealLap,
    laps,
    getGhostFrame
  } = useTelemetry(selectedSource);

  const [showGhost, setShowGhost] = useState(true);

  // Calculate projection parameters
  const projectionParams = useMemo(() => {
    if (!data || data.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    let minAlt = Infinity, maxAlt = -Infinity;

    data.forEach(f => {
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
  }, [data]);

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
  const ghostFrame = useMemo(() => getGhostFrame(currentFrame), [currentFrame, getGhostFrame]);
  
  const ghostPosition = useMemo(() => {
    if (!ghostFrame || !projectionParams) return null;
    const { centerLat, centerLon, latScale, lonScale } = projectionParams;
    const x = (ghostFrame.longitude - centerLon) * lonScale;
    const z = -(ghostFrame.latitude - centerLat) * latScale; // Negate Z for correct orientation
    // console.log('Ghost:', { t: ghostFrame.time, x, z });
    return [x, 0.5, z] as [number, number, number]; // Lift slightly
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedSource(e.target.files[0]);
    }
  };

  // Drag Handling
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newSplit = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    
    // Clamp between 20% and 80%
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


  if (loading && !data.length) return <div className="flex items-center justify-center h-screen bg-gray-900 text-white">Loading Telemetry...</div>;
  if (error) return <div className="flex items-center justify-center h-screen bg-gray-900 text-red-500">Error: {error.message}</div>;

  // Helper to determine active views count for layout
  const activeViews = [showPitView, showDriverView, showCoachView].filter(Boolean).length;

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden font-sans selection:bg-blue-500/30">
      
      {/* Header */}
      <header className="h-14 border-b border-gray-800 bg-gray-900/50 backdrop-blur flex items-center justify-between px-4 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-blue-500">
            <LayoutDashboard size={20} />
            <span className="font-bold tracking-tight">RACE<span className="text-white">REPLAY</span></span>
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
            {idealLap && (
                <div className="flex items-center gap-2 bg-gray-800/50 px-3 py-1 rounded border border-gray-700">
                    <Trophy size={14} className="text-yellow-500" />
                    <span className="text-xs text-gray-400">Ideal Lap:</span>
                    <span className="text-sm font-mono font-bold text-yellow-400">{idealLap.lapTime.toFixed(3)}s</span>
                </div>
            )}
            <div className="text-sm text-gray-400">
              {currentFrame?.time.toFixed(2)}s / {data[data.length-1]?.time.toFixed(2)}s
            </div>
            {/* File Selector */}
            <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1">
              <FileText size={16} className="text-gray-400" />
              <select 
                className="bg-transparent text-sm focus:outline-none max-w-[200px]"
                value={typeof selectedSource === 'string' ? selectedSource : ''}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                {manifest.map(file => (
                  <option key={file.url} value={file.url}>{file.name}</option>
                ))}
                {selectedSource instanceof File && <option value="">{selectedSource.name} (Local)</option>}
              </select>
            </div>

            {/* Local File Upload */}
            <label className="cursor-pointer flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm hover:shadow group" title="Upload local telemetry CSV file">
              <Upload size={16} className="group-hover:scale-110 transition-transform" />
              <span>Upload CSV</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            </label>
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
            />
          </div>
        )}

        {/* Resizer (Only if Pit + Driver are the ONLY two views, or maybe just between first and second?) 
            For simplicity, let's only enable resizer if exactly Pit and Driver are active.
        */}
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

        {!showPitView && !showDriverView && !showCoachView && (
          <div className="flex-grow flex items-center justify-center text-gray-500">
            Select a view from the toolbar
          </div>
        )}
      </main>

      <footer className="bg-gray-900 border-t border-gray-800 p-4">
        <div className="flex flex-col gap-2">
          {/* Scrubber */}
          <input 
            type="range" 
            min="0" 
            max={data.length - 1} 
            value={currentIndex} 
            onChange={(e) => seek(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          
          {/* Controls */}
          <div className="flex justify-center items-center gap-4 mt-2">
            <button 
              onClick={() => seek(Math.max(0, currentIndex - 100))}
              className="p-2 hover:bg-gray-800 rounded-full transition"
            >
              <SkipBack size={24} />
            </button>
            
            <button 
              onClick={togglePlay}
              className="p-3 bg-blue-600 hover:bg-blue-700 rounded-full transition shadow-lg shadow-blue-900/20"
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>
            
            <button 
              onClick={() => seek(Math.min(data.length - 1, currentIndex + 100))}
              className="p-2 hover:bg-gray-800 rounded-full transition"
              title="Skip Forward"
            >
              <SkipForward size={24} />
            </button>

            <div className="w-px h-8 bg-gray-800 mx-2" />

            <button
              onClick={() => seek(0)}
              className="p-2 hover:bg-gray-800 rounded-full transition text-gray-400 hover:text-white"
              title="Reset Playback"
            >
              <RotateCcw size={20} />
            </button>

            <button
              onClick={() => setIsLooping(!isLooping)}
              className={`p-2 rounded-full transition ${isLooping ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
              title="Auto-Replay"
            >
              <Repeat size={20} />
            </button>

            <div className="ml-4 flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Speed</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 text-gray-300"
              >
                <option value={0.1}>0.1x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
