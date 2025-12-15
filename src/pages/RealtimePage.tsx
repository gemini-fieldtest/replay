import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRealtimeTelemetry } from '../hooks/useRealtimeTelemetry';
import { type TelemetryFrame } from '../utils/telemetryParser';
import {
  Trophy, LayoutGrid, Rows,
  Gauge, Flag, Map, CarFront, Headset, Sparkles // Racing Icons
} from 'lucide-react';
import { LiveVideoPlayer } from '../components/LiveVideoPlayer';
import { RealtimePitView } from './RealtimePitView';
import { RealtimeCoach } from './RealtimeCoach';
import { loadKML, type GeoCoordinate } from '../utils/kmlLoader';
import { useTheme } from '../components/ThemeProvider';
import { downloadSessionJSON } from '../utils/telemetryExport';
import { Save, RefreshCw, Disc, Play } from 'lucide-react';
import { type CoachMessage } from './RealtimeCoach';




interface TrackPoint {
  name: string;
  lat: number;
  long: number;
}

interface TrackSegment {
  id: string;
  startPoint: string;
  endPoint: string;
  type: 'straight' | 'corner';
}

export const RealtimePage = () => {
  // Default to localhost telemetry server or saved preference
  const [sourceUrl, setSourceUrl] = useState<string | null>(() => {
    // Prioritize URL param if we added that feature, otherwise localStorage
    return localStorage.getItem('realtime_source_url') || 'http://localhost:8000/events';
  });

  const [customUrl, setCustomUrl] = useState(() => {
    return localStorage.getItem('realtime_custom_url') || '';
  });

  // Effects for persistence
  useEffect(() => {
    if (sourceUrl && !sourceUrl.startsWith('blob:')) { // Don't save blob URLs (files)
      localStorage.setItem('realtime_source_url', sourceUrl);
    }
  }, [sourceUrl]);

  useEffect(() => {
    localStorage.setItem('realtime_custom_url', customUrl);
  }, [customUrl]);

  const simulationFiles = [
    { label: 'Live (Localhost)', value: 'http://localhost:8000/events' },
    { label: 'Thunderhill (08/01/2025)', value: '/data/0-thunderhill_08012025.csv' },
    { label: 'AJ Buttonwillow (Nov 2025)', value: '/data/aj_bw_Nov2025.csv' },
    { label: 'Buttonwillow (11/21/2025)', value: '/data/buttonwillow_11212025.csv' },
    { label: 'Buttonwillow B (11/21/2025)', value: '/data/buttonwillow_11212025_b.csv' },
    { label: 'Randy Buttonwillow (Nov 2025)', value: '/data/randy_bw_Nov2025.csv' },
    { label: 'Circle Simulation', value: 'simulation' },
    { label: 'Local File', value: 'local_file' },
    { label: 'Custom URL', value: 'custom' },
  ];
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [trackSegments, setTrackSegments] = useState<TrackSegment[]>([]);
  const [startLine, setStartLine] = useState<{ lat: number, lon: number } | undefined>(undefined);

  // Ref to track coach messages for export without re-rendering parent
  const coachMessagesRef = useRef<CoachMessage[]>([]);

  const {
    data,
    loading,
    error,
    currentFrame,
    currentIndex,

    idealLap,
    laps,
    getGhostFrame,
    fullTrackBuffer, // Use this for stable map projection
    resetSession,
    setIsPlaying
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
          const json = await response.json();
          let points: TrackPoint[] = [];
          if (Array.isArray(json)) {
            points = json;
          } else {
            points = json.points || [];
            if (json.segments) setTrackSegments(json.segments);
          }

          setTrackPoints(points);
          const startPoint = points.find((p) => p.name === 'start');
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

    const { centerLat, centerLon, centerAlt, latScale: trackLatScale, lonScale: trackLonScale } = projectionParams;



    const pos = new Float32Array(sourceData.length * 3);

    sourceData.forEach((f, i) => {
      pos[i * 3] = (f.longitude - centerLon) * trackLonScale;
      pos[i * 3 + 1] = (f.altitude - centerAlt) * 5; // Y is up
      pos[i * 3 + 2] = -(f.latitude - centerLat) * trackLatScale; // Z is forward/back
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
  const ghostFrame = useMemo((): TelemetryFrame | null => getGhostFrame(), [getGhostFrame]);

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

          {!isStacked && (
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
        </div>

        <div className="flex items-center gap-6">


          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 border border-gray-200 dark:border-gray-700">
            <span className="text-gray-500 text-xs">SOURCE</span>
            <select
              value={
                simulationFiles.some(f => f.value === sourceUrl) ? sourceUrl! :
                  sourceUrl?.startsWith('blob:') ? 'local_file' : 'custom'
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setSourceUrl(customUrl);
                } else if (val === 'local_file') {
                  fileInputRef.current?.click();
                } else {
                  setSourceUrl(val);
                }
              }}
              className="bg-transparent border-none text-xs text-gray-900 dark:text-white w-32 focus:outline-none"
              style={{ textOverflow: 'ellipsis' }}
            >
              {simulationFiles.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  setSourceUrl(url);
                  // Cleanup URL when component unmounts or url changes? 
                  // React state updates are fast, handling cleanup in useEffect might be complex with blob retention.
                  // Browser cleans up on reload.
                }
                // Reset input so same file can be selected again
                e.target.value = '';
              }}
            />
            {(!simulationFiles.some(f => f.value === sourceUrl) && !sourceUrl?.startsWith('blob:')) && (
              <input
                type="text"
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  setSourceUrl(e.target.value);
                }}
                className="bg-transparent border-l border-gray-300 dark:border-gray-600 pl-2 text-xs text-gray-900 dark:text-white w-32 focus:outline-none"
                placeholder="Custom URL"
              />
            )}
          </div>





          {error ? (
            <div title={error.message} className="flex items-center gap-2 px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-500">
              <div className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-500" />
              <span className="text-xs font-bold tracking-wider line-through">LIVE</span>
            </div>
          ) : loading && !data.length ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-500">
              <div className="w-2 h-2 rounded-full bg-yellow-600 dark:bg-yellow-500 animate-pulse" />
              <span className="text-xs font-bold tracking-wider">CONNECTING</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-500">
              <div className="w-2 h-2 rounded-full bg-green-600 dark:bg-green-500 animate-pulse" />
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

          {data.length === 0 ? (
            <button
              onClick={() => {
                resetSession();
                setIsPlaying(true);
              }}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded shadow-sm transition-colors text-xs font-bold uppercase tracking-wider"
              title="Start Recording Session"
            >
              <Play size={14} className="fill-current" />
              <span>Start Session</span>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              {/* Reset only needed if user wants to discard without saving? 
                    User requested "Start button that turns into Save button". 
                    "On save, we auto reset".
                    So maybe we don't need explicit Reset if Save does it?
                    But what if I want to discard? "Reset" is still useful.
                    User asked to "consolidate".
                    Let's keep Reset but make Save the primary action that replaces Start.
                */}
              <button
                onClick={() => {
                  if (confirm("Discard current session data?")) {
                    resetSession();
                    setIsPlaying(false);
                  }
                }}
                className="flex items-center gap-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded shadow-sm transition-colors text-xs font-bold uppercase tracking-wider mr-1"
                title="Discard Session"
              >
                <RefreshCw size={14} />
                <span>Discard</span>
              </button>
              <button
                onClick={() => {
                  setIsPlaying(false); // Pause

                  // Export as JSON with rich metadata
                  downloadSessionJSON(
                    data,
                    coachMessagesRef.current,
                    {
                      track: "Thunderhill East", // Could be dynamic if we tracked it
                      source: "Live Session",
                      date: new Date().toISOString()
                    },
                    `session_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
                  );

                  // Auto-reset after save (maybe slight delay or immediately?)
                  // Immediate reset might feel abrupt?
                  // "on save, we auto reset" - User instruction.
                  resetSession();
                  // Clear messages ref locally strictly speaking handled by reset but ref persists until overwritten?
                  coachMessagesRef.current = [];
                }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded shadow-sm transition-colors text-xs font-bold uppercase tracking-wider animate-pulse"
                title="Stop & Save Session"
              >
                <Save size={14} />
                <span>Save Session</span>
              </button>
            </div>
          )}

          {/* Recording Indicator */}
          {!loading && !error && (
            <div className="ml-2 flex items-center gap-2 text-xs font-mono text-gray-500 animate-pulse" title="Session Recording Active">
              <Disc size={12} className="text-red-500 fill-red-500" />
              <span>REC</span>
              <span>{new Date(data.length > 0 ? (data[data.length - 1].time - data[0].time) * 1000 : 0).toISOString().substr(14, 5)}</span>
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
              width: isStacked ? '100%' : (activeViews === 1 ? '100%' : (activeViews === 2 && showDriverView && !showCoachView ? `${splitPosition}%` : `${100 / activeViews}%`)),
              flex: isStacked ? 'none' : ((activeViews === 2 && showDriverView && !showCoachView) ? 'none' : '1'),
              height: isStacked ? '600px' : 'auto'
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
              segments={trackSegments}
              trackPoints={trackPoints}
              projectionParams={projectionParams}
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

        {/* Coach View */}
        {showCoachView && (
          <div
            className="flex flex-col min-w-0 overflow-hidden"
            style={{
              width: isStacked ? '100%' : (activeViews === 1 ? '100%' : `${100 / activeViews}%`),
              flex: isStacked ? 'none' : '1',
              height: isStacked ? '600px' : 'auto',
              maxHeight: '600px'
            }}
          >
            <RealtimeCoach
              currentFrame={currentFrame}
              ghostFrame={ghostFrame}
              idealLap={idealLap}
              currentIndex={currentIndex}
              laps={laps}
              trackPoints={trackPoints}
              onMessagesUpdate={(msgs) => {
                coachMessagesRef.current = msgs;
              }}
            />
          </div>
        )}
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
              width: isStacked ? '100%' : (activeViews === 1 ? '100%' : (activeViews === 2 && showPitView && !showCoachView ? `${100 - splitPosition}%` : `${100 / activeViews}%`)),
              flex: isStacked ? 'none' : ((activeViews === 2 && showPitView && !showCoachView) ? 'none' : '1'),
              height: isStacked ? 'auto' : 'auto'
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


      </main>


    </div>
  );
}
