import React, { useState, useRef, useEffect } from 'react';
import { ReplayTrackMap3D } from '../components/ReplayTrackMap3D';
import { ReplayHUD } from '../components/ReplayHUD';
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';
import { Video, Box, Upload, Settings2 } from 'lucide-react';

interface ReplayDriverViewProps {
  positions: Float32Array;
  data?: TelemetryFrame[]; // Added to pass full data for imperative updates
  currentIndexRef?: React.MutableRefObject<number>; // Added ref support
  currentIndex: number;
  currentFrame: TelemetryFrame | null;
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost: boolean;
  setShowGhost: (show: boolean) => void;
  startLinePos?: [number, number, number] | null;
  videoSrc: string | null;
  videoOffset: number;
  setVideoOffset: (offset: number) => void;
  onVideoUpload: (file: File) => void;
  isPlaying?: boolean;

  // New props for optimized 3D
  ghostPathPositions?: Float32Array;
  idealLap?: LapData | null;
  laps?: LapData[];
}

export const ReplayDriverView: React.FC<ReplayDriverViewProps> = ({
  positions,
  data,
  currentIndexRef,
  currentIndex,
  currentFrame,
  showGhost,
  startLinePos,
  videoSrc,
  videoOffset,
  setVideoOffset,
  onVideoUpload,
  isPlaying = false,
  ghostPathPositions,
  idealLap,
  laps
}) => {
  const [viewMode, setViewModeState] = useState<'3d' | 'video'>(() => {
    return (localStorage.getItem('driver_view_mode') as '3d' | 'video') || '3d';
  });
  // Local state removed, using props
  const videoRef = useRef<HTMLVideoElement>(null);

  const setViewMode = (mode: '3d' | 'video') => {
    setViewModeState(mode);
    localStorage.setItem('driver_view_mode', mode);
  };


  // Handle File Upload
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onVideoUpload(file);
    }
  };


  // Synchronization Logic
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentFrame || !viewMode) return;

    if (viewMode !== 'video') {
      if (!video.paused) video.pause();
      return;
    }

    const targetTime = currentFrame.time + videoOffset;

    // Ensure we are within bounds
    if (targetTime < 0) {
      if (!video.paused) video.pause();
      video.currentTime = 0;
      return;
    }

    if (isPlaying) {
      // Playback Sync
      if (video.paused) {
        video.play().catch(e => console.error("Video play failed:", e));
      }

      // Drift Correction
      const diff = Math.abs(video.currentTime - targetTime);
      if (diff > 0.3) {
        // console.log("Syncing video drift:", diff);
        video.currentTime = targetTime;
      } else {
        // Fine tuning playback rate could happen here for super smooth sync
      }
    } else {
      // Paused Sync - Scrubs exactly
      if (!video.paused) video.pause();
      // Only seek if significantly different to avoid jitter during pause
      if (Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = targetTime;
      }
    }

  }, [currentFrame, isPlaying, videoOffset, viewMode]);


  return (
    <div className="flex-grow bg-gray-100 dark:bg-gray-900 flex flex-col min-h-0 relative group">

      {/* View Toggles & Controls Overlay */}
      <div className="absolute bottom-4 left-4 z-20 flex gap-2">
        <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg p-1 border border-gray-200 dark:border-gray-700 flex gap-1 shadow-sm">
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${viewMode === '3d'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
          >
            <Box size={14} />
            Sim
          </button>
          <button
            onClick={() => setViewMode('video')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${viewMode === 'video'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
          >
            <Video size={14} />
            Video
          </button>
        </div>

        {viewMode === 'video' && videoSrc && (
          <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg p-2 border border-gray-200 dark:border-gray-700 flex items-center gap-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Settings2 size={14} />
              <span className="font-mono">Sync: {videoOffset.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="-60"
              max="60"
              step="0.05"
              value={videoOffset}
              onChange={(e) => setVideoOffset(parseFloat(e.target.value))}
              className="w-32 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
            <button
              onClick={() => setVideoOffset(0)}
              className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="flex-grow relative min-h-0 overflow-hidden">
        {viewMode === '3d' ? (
          <>
             <ReplayTrackMap3D
                positions={positions}
                data={data}
                currentIndexRef={currentIndexRef}
                currentIndex={currentIndex}

                // Only pass ghostPosition if we want to support fallback or if we haven't fully migrated.
                // But now we use imperative ghost inside.
                // However, ReplayTrackMap3D still accepts ghostPosition for fallback?
                // Let's pass null to force usage of imperative ghost if data is available?
                // Or just pass it anyway, but the component prefers imperative if provided?
                // The updated component renders ImperativeGhostCar if showGhost is true.
                // It also renders prop-based ghost if showGhost && ghostPosition is true.
                // We should probably remove ghostPosition from here to avoid double ghost.
                ghostPosition={null}

                showGhost={showGhost}
                startLinePos={startLinePos}

                ghostPositions={ghostPathPositions}
                idealLap={idealLap}
                laps={laps}
              />
              {/* Render HUD separately */}
              <ReplayHUD currentFrame={currentFrame} />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black">
            {!videoSrc ? (
              <div className="text-center p-8 bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 border-dashed">
                <Upload className="mx-auto text-gray-400 dark:text-gray-500 mb-4" size={48} />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Upload Onboard Video</h3>
                <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto">
                  Load a local video file to verify simulation accuracy.
                </p>
                <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg cursor-pointer transition-colors shadow-lg inline-flex items-center gap-2">
                  <span>Select Video File</span>
                  <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
                </label>
              </div>
            ) : (
              <video
                ref={videoRef}
                src={videoSrc}
                className="w-full h-full object-contain"
                muted // Mute by default to avoid blast
                playsInline
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
