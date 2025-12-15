import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Repeat,
  LayoutGrid, Rows,
  Gauge, Flag, Map, CarFront, Headset, Ghost, FileText, Sparkles // Racing Icons
} from 'lucide-react';
import { useTelemetry } from '../hooks/useTelemetry';
import { type TrackPoint } from '../hooks/useTrackLocation';
import { ReplayPitView } from './ReplayPitView';
import { ReplayDriverView } from './ReplayDriverView';
import { PerformanceCoach } from './PerformanceCoach';

interface TrackSegment {
  id: string;
  startPoint: string;
  endPoint: string;
  type: 'straight' | 'corner';
}

import { useTheme } from '../components/ThemeProvider';
import { Link } from 'react-router-dom';

interface ManifestFile {
  name: string;
  url: string;
  size: number;
}

export function ReplayPage() {
  const [manifest, setManifest] = useState<ManifestFile[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | File | null>(null);

  // Layout State
  const [showPitView, setShowPitView] = useState(true);
  const [showDriverView, setShowDriverView] = useState(true);
  const [showCoachView, setShowCoachView] = useState(true);
  const [splitPosition, setSplitPosition] = useState(50); // Percentage
  const [isResizing, setIsResizing] = useState(false);
  const [layoutMode] = useState<'grid' | 'stacked'>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode') as 'grid' | 'stacked';
    if (urlMode) return urlMode;
    return (localStorage.getItem('replay_layout_mode') as 'grid' | 'stacked') || 'stacked';
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);



  const { theme, toggleTheme } = useTheme();

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

  const [showGhost, setShowGhost] = useState(true);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [trackSegments, setTrackSegments] = useState<TrackSegment[]>([]);
  const [trackDetails, setTrackDetails] = useState<string>('');

  // Video State (Lifted for Report Generation)
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoOffset, setVideoOffset] = useState<number>(() => {
    const saved = localStorage.getItem('driver_video_offset');
    return saved ? parseFloat(saved) : 0;
  });

  const handleVideoOffsetChange = (offset: number) => {
    setVideoOffset(offset);
    localStorage.setItem('driver_video_offset', offset.toString());
  };

  const handleVideoUpload = (file: File) => {
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
  };


  // Extract Start Line from Track Points
  const startLine = useMemo(() => {
    const startPoint = trackPoints.find((p) => p.name === 'start');
    if (startPoint) {
      return { lat: startPoint.lat, lon: startPoint.long };
    }
    return undefined;
  }, [trackPoints]);

  useEffect(() => {
    // Load track points
    fetch('/tracks/thunderhill/points.json')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setTrackPoints(data);
        } else {
          setTrackPoints(data.points || []);
          if (data.segments) setTrackSegments(data.segments);
        }
      })
      .catch(err => console.error('Failed to load track points:', err));

    // Load track details
    fetch('/tracks/thunderhill/details.txt')
      .then(res => res.text())
      .then(text => setTrackDetails(text))
      .catch(err => console.error('Failed to load track details:', err));
  }, []);

  // Load telemetry data using hook
  const {
    loading,
    error,
    currentFrame,
    isPlaying,
    togglePlay,
    seek,
    currentIndex,
    data,
    idealLap,
    laps,
    getGhostFrame,
    isLooping,
    setIsLooping,
    playbackSpeed,
    setPlaybackSpeed
  } = useTelemetry(selectedSource, startLine);

  const toggleLayoutMode = (mode: 'grid' | 'stacked') => {
    localStorage.setItem('replay_layout_mode', mode);
    const params = new URLSearchParams(window.location.search);
    params.set('mode', mode);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    // Force reload as requested
    window.location.reload();
  };


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
      window.addEventListener('mouseup', handleMouseUp);
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
  // If we are in grid mode, have the coach enabled, and at least one other view, we use the "Sidebar" layout for the coach


  return (
    <div className="h-screen w-full bg-white dark:bg-black text-gray-900 dark:text-white flex flex-col overflow-hidden font-sans selection:bg-blue-500/30">

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
            <Link to="/" title="Live Telemetry" className="flex items-center justify-center p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50 transition-colors">
              <Gauge size={16} />
            </Link>
            <div title="Replay Analysis" className="flex items-center justify-center p-1.5 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent cursor-default">
              <Flag size={16} />
            </div>
          </div>

          {layoutMode === 'grid' && (
            <>
              <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-1" />

              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-0.5">
                <button
                  onClick={() => setShowPitView(!showPitView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${showPitView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
                    }`}
                >
                  <Map size={14} />
                  Pit
                </button>
                <button
                  onClick={() => setShowDriverView(!showDriverView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${showDriverView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
                    }`}
                >
                  <CarFront size={14} />
                  Driver
                </button>
                <button
                  onClick={() => setShowCoachView(!showCoachView)}
                  className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${showCoachView ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-transparent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700/50'
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

          <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />

          {/* Ghost Toggle */}
          <button
            onClick={() => setShowGhost(!showGhost)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showGhost ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border border-yellow-500/50' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
              }`}
            title="Toggle Ideal Lap Overlay"
          >
            <Ghost size={14} />
            <span>Ghost Lap</span>
          </button>

          <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />
        </div>

        {/* Playback Controls - Moved to Header */}
        <div className="flex items-center gap-2 mx-4">
          <button
            onClick={() => seek(Math.max(0, currentIndex - 100))}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            title="Rewind"
          >
            <SkipBack size={16} />
          </button>

          <button
            onClick={togglePlay}
            className={`p-1.5 rounded-full transition shadow-lg ${isPlaying ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/20' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            onClick={() => seek(Math.min(data.length - 1, currentIndex + 100))}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            title="Skip Forward"
          >
            <SkipForward size={16} />
          </button>

          {/* Scrubber - Compact */}
          <div className="w-48 mx-2 flex items-center">
            <input
              type="range"
              min="0"
              max={data.length > 0 ? data.length - 1 : 100}
              value={currentIndex}
              onChange={(e) => seek(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600 dark:accent-blue-500"
            />
          </div>

          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`p-1.5 rounded-full transition ${isLooping ? 'text-blue-600 dark:text-blue-500 bg-blue-500/10' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            title="Loop"
          >
            <Repeat size={16} />
          </button>

          <div className="h-4 w-px bg-gray-300 dark:bg-gray-700 mx-1" />

          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            className="bg-transparent text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white focus:outline-none cursor-pointer"
            title="Playback Speed"
          >
            <option value={0.1}>0.1x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>
        </div>

        <div className="flex items-center gap-6">

          <div className="text-sm text-gray-500 dark:text-gray-400 w-56 text-right tabular-nums font-mono mr-2">
            {currentFrame?.time.toFixed(2)}s / {data[data.length - 1]?.time.toFixed(2)}s
          </div>
          {/* File Selector */}
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded px-2 py-1">
            <FileText size={16} className="text-gray-500 dark:text-gray-400" />
            <select
              className="bg-transparent text-sm focus:outline-none max-w-[200px] text-gray-900 dark:text-white"
              value={typeof selectedSource === 'string' ? selectedSource : ''}
              onChange={(e) => {
                if (e.target.value === '__custom_upload__') {
                  fileInputRef.current?.click();
                } else {
                  setSelectedSource(e.target.value);
                }
              }}
            >
              {manifest.map(file => (
                <option key={file.url} value={file.url}>{file.name}</option>
              ))}
              {selectedSource instanceof File && <option value="">{selectedSource.name} (Local)</option>}
              <option disabled>──────────</option>
              <option value="__custom_upload__">Browse for file...</option>
            </select>
          </div>

          {/* Hidden Input for File Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex-grow p-4 flex gap-4 ${layoutMode === 'stacked' ? 'flex-col overflow-y-auto' : 'overflow-hidden'}`}
        ref={containerRef}
      >

        {/* Pit View */}
        {showPitView && (
          <div
            className="flex flex-col min-w-0 overflow-hidden"
            style={{
              width: layoutMode === 'stacked'
                ? '100%'
                : (activeViews === 1 ? '100%' : (activeViews === 2 && showDriverView && !showCoachView ? `${splitPosition}%` : `${100 / activeViews}%`)),
              flex: layoutMode === 'stacked'
                ? 'none'
                : ((activeViews === 2 && showDriverView && !showCoachView) ? 'none' : '1'),
              height: layoutMode === 'stacked' ? 'auto' : 'auto'
            }}
          >
            <ReplayPitView
              currentFrame={currentFrame}
              trackPositions={trackPositions}
              currentIndex={currentIndex}
              getHistory={getHistory}
              ghostFrame={ghostFrame}
              ghostPosition={ghostPosition}
              showGhost={showGhost}
              idealLap={idealLap}
              laps={laps}
              isStacked={layoutMode === 'stacked'}
              segments={trackSegments}
              trackPoints={trackPoints}
              projectionParams={projectionParams}
            />
          </div>
        )}

        {/* Resizer */}
        {showPitView && showDriverView && !showCoachView && layoutMode === 'grid' && (
          <div
            className="w-1 bg-gray-200 dark:bg-gray-800 hover:bg-blue-500 hover:dark:bg-blue-500 cursor-col-resize flex items-center justify-center transition-colors group z-10"
            onMouseDown={startResizing}
          >
            <div className="h-8 w-1 bg-gray-600 group-hover:bg-white rounded-full" />
          </div>
        )}

        {/* Coach View */}
        {showCoachView && (
          <div
            className="flex flex-col min-w-0 overflow-hidden"
            style={{
              width: layoutMode === 'stacked' ? '100%' : (activeViews === 1 ? '100%' : `${100 / activeViews}%`),
              flex: layoutMode === 'stacked' ? 'none' : '1',
              height: layoutMode === 'stacked' ? '600px' : 'auto'
            }}
          >
            <PerformanceCoach
              currentFrame={currentFrame}
              ghostFrame={ghostFrame}
              currentIndex={currentIndex}
              laps={laps}
              idealLap={idealLap}
              trackPoints={trackPoints}
              trackDetails={trackDetails}
              // Video Props for Report
              videoFile={videoFile}
              videoOffset={videoOffset}
            />

          </div>
        )}
        {showPitView && showDriverView && !showCoachView && layoutMode === 'grid' && (
          <div
            className="w-1 bg-gray-200 dark:bg-gray-800 hover:bg-blue-500 hover:dark:bg-blue-500 cursor-col-resize flex items-center justify-center transition-colors group z-10"
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
              width: layoutMode === 'stacked'
                ? '100%'
                : (activeViews === 1 ? '100%' : (activeViews === 2 && showPitView && !showCoachView ? `${100 - splitPosition}%` : `${100 / activeViews}%`)),
              flex: layoutMode === 'stacked'
                ? 'none'
                : ((activeViews === 2 && showPitView && !showCoachView) ? 'none' : '1'),
              height: layoutMode === 'stacked' ? '600px' : 'auto'
            }}
          >
            <div className="flex-grow relative h-full flex flex-col">
              <ReplayDriverView
                positions={trackPositions}
                currentIndex={currentIndex}
                currentFrame={currentFrame}
                ghostFrame={ghostFrame}
                ghostPosition={ghostPosition}
                showGhost={showGhost}
                setShowGhost={setShowGhost}
                startLinePos={startLinePos}
                isPlaying={isPlaying}
                // Video Props
                videoSrc={videoSrc}
                videoOffset={videoOffset}
                setVideoOffset={handleVideoOffsetChange}
                onVideoUpload={handleVideoUpload}
              />

            </div>
          </div>
        )}



        {!showPitView && !showDriverView && !showCoachView && (
          <div className="flex-grow flex items-center justify-center text-gray-500">
            Select a view from the toolbar
          </div>
        )}
      </main>


    </div>
  );
}
