import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import { Play, Pause, SkipForward, SkipBack, FileText, Upload, LayoutDashboard, Car, GripVertical, RotateCcw, Repeat } from 'lucide-react';
import { PitView } from './pages/PitView';
import { DriverView } from './pages/DriverView';

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
  const [splitPosition, setSplitPosition] = useState(50); // Percentage
  const [isDragging, setIsDragging] = useState(false);
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
    setIsLooping
  } = useTelemetry(selectedSource);

  const trackPositions = useMemo(() => {
    if (!data || data.length === 0) return new Float32Array(0);

    // Find bounds to center the track
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

    const pos = new Float32Array(data.length * 3);
    
    data.forEach((f, i) => {
      pos[i * 3] = (f.longitude - centerLon) * lonScale;
      pos[i * 3 + 1] = (f.altitude - centerAlt) * 5; // Y is up
      pos[i * 3 + 2] = -(f.latitude - centerLat) * latScale; // Z is forward/back
    });
    
    return pos;
  }, [data]);

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
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newSplit = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    
    // Clamp between 20% and 80%
    setSplitPosition(Math.min(Math.max(newSplit, 20), 80));
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
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
  }, [isDragging, handleMouseMove, handleMouseUp]);


  if (loading && !data.length) return <div className="flex items-center justify-center h-screen bg-gray-900 text-white">Loading Telemetry...</div>;
  if (error) return <div className="flex items-center justify-center h-screen bg-gray-900 text-red-500">Error: {error.message}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-blue-500">Race Replay</h1>
          
          {/* View Toggles */}
          <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
            <button 
              onClick={() => setShowPitView(!showPitView)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                showPitView ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <LayoutDashboard size={16} />
              Pit View
            </button>
            <button 
              onClick={() => setShowDriverView(!showDriverView)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                showDriverView ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Car size={16} />
              Driver View
            </button>
          </div>

          {/* File Selector */}
          <div className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1 ml-4">
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
          <label className="cursor-pointer bg-gray-800 hover:bg-gray-700 p-1.5 rounded text-gray-400 hover:text-white transition">
            <Upload size={16} />
            <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          </label>
        </div>

        <div className="text-sm text-gray-400">
          {currentFrame?.time.toFixed(2)}s / {data[data.length-1]?.time.toFixed(2)}s
        </div>
      </header>

      <main className="flex-grow p-4 flex gap-4 overflow-hidden" ref={containerRef}>
        {/* Split Screen Layout */}
        
        {/* Left: Pit View */}
        {showPitView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: showDriverView ? `${splitPosition}%` : '100%',
              flex: showDriverView ? 'none' : '1'
            }}
          >
            <PitView 
              currentFrame={currentFrame}
              trackPositions={trackPositions}
              currentIndex={currentIndex}
              getHistory={getHistory}
            />
          </div>
        )}

        {/* Divider Handle */}
        {showPitView && showDriverView && (
          <div 
            className="w-2 bg-gray-800 hover:bg-blue-500 cursor-col-resize flex items-center justify-center transition-colors rounded hover:shadow-[0_0_10px_rgba(59,130,246,0.5)] z-10"
            onMouseDown={handleMouseDown}
          >
            <GripVertical size={12} className="text-gray-500" />
          </div>
        )}

        {/* Right: Driver View */}
        {showDriverView && (
          <div 
            className="flex flex-col min-w-0 overflow-hidden"
            style={{ 
              width: showPitView ? `${100 - splitPosition}%` : '100%',
              flex: showPitView ? 'none' : '1'
            }}
          >
            <DriverView 
              telemetryData={data} 
              currentTime={currentFrame?.time || 0} 
              currentFrame={currentFrame}
            />
          </div>
        )}

        {!showPitView && !showDriverView && (
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
