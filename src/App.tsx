import { useState, useMemo, useEffect } from 'react';
import { useTelemetry } from './hooks/useTelemetry';
import { Gauges } from './components/Gauges';
import { Play, Pause, SkipForward, SkipBack, Box, Map, FileText, Upload } from 'lucide-react';
import { TrackMap } from './components/TrackMap';
import { TrackMap3D } from './components/TrackMap3D';

interface ManifestFile {
  name: string;
  url: string;
  lastModified: number;
  size: number;
}

function App() {
  const [manifest, setManifest] = useState<ManifestFile[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | File | null>(null);
  const [show3D, setShow3D] = useState(false);

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
    setPlaybackSpeed
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

  if (loading && !data.length) return <div className="flex items-center justify-center h-screen bg-gray-900 text-white">Loading Telemetry...</div>;
  if (error) return <div className="flex items-center justify-center h-screen bg-gray-900 text-red-500">Error: {error.message}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-blue-500">Race Replay</h1>
          
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
          <label className="cursor-pointer bg-gray-800 hover:bg-gray-700 p-1.5 rounded text-gray-400 hover:text-white transition">
            <Upload size={16} />
            <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          </label>
        </div>

        <div className="text-sm text-gray-400">
          {currentFrame?.time.toFixed(2)}s / {data[data.length-1]?.time.toFixed(2)}s
        </div>
      </header>

      <main className="flex-grow p-4 flex gap-4">
        <div className="flex-grow flex flex-col gap-4">
          {/* Track Map */}
          <div className="bg-gray-900 rounded-lg h-96 border border-gray-800 overflow-hidden relative group">
             {show3D ? (
               <TrackMap3D positions={trackPositions} currentIndex={currentIndex} />
             ) : (
               <TrackMap positions={trackPositions} currentIndex={currentIndex} />
             )}
             
             <button
               onClick={() => setShow3D(!show3D)}
               className="absolute top-4 right-4 bg-gray-800/80 hover:bg-gray-700 p-2 rounded text-white backdrop-blur-sm transition-all z-10 flex items-center gap-2 border border-gray-700"
             >
               {show3D ? <Map size={16} /> : <Box size={16} />}
               <span className="text-xs font-medium">{show3D ? '2D View' : '3D View'}</span>
             </button>
          </div>
          
          <Gauges 
            frame={currentFrame} 
            getHistory={getHistory}
          />
        </div>
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
            >
              <SkipForward size={24} />
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
