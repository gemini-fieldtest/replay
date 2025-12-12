import React, { useState, useMemo } from 'react';
import { ReplayGauges } from '../components/ReplayGauges';
import { ReplayTrackMap } from '../components/ReplayTrackMap';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { type LapData } from '../utils/lapAnalysis';

interface ReplayPitViewProps {
  currentFrame: TelemetryFrame | null;
  trackPositions: Float32Array;
  currentIndex: number;
  getHistory: () => TelemetryFrame[];
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost?: boolean;
  idealLap?: LapData | null;
  laps?: LapData[];
  isStacked?: boolean;
}

export const ReplayPitView: React.FC<ReplayPitViewProps> = ({
  currentFrame,
  trackPositions,
  currentIndex,
  getHistory,
  ghostFrame,
  ghostPosition,
  showGhost,
  idealLap,
  laps = [],
  isStacked = false
}) => {
  const [calibration, setCalibration] = useState({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0
  });

  const [showCalibration, setShowCalibration] = useState(false);

  // Helper to get ghost history (ideal lap frames up to current ghost time)
  const getGhostHistory = useMemo(() => {
     return () => {
         if (!idealLap || !ghostFrame) return [];
         // Return frames from ideal lap up to the ghost frame
         // Assuming idealLap.frames are sorted
         const idx = idealLap.frames.indexOf(ghostFrame);
         if (idx === -1) return [];
         return idealLap.frames.slice(0, idx + 1);
     };
  }, [idealLap, ghostFrame]);

  return (
    <div className={`flex-grow flex gap-4 ${isStacked ? 'h-auto' : 'h-full'}`}>
      <div className={`flex-grow flex flex-col gap-4 ${isStacked ? 'h-auto' : 'h-full'}`}>
        <div className={`flex gap-4 h-96 shrink-0 relative z-20`}>
            {/* Track Map */}
            <div className="bg-gray-100 dark:bg-gray-900 rounded-lg flex-grow border border-gray-200 dark:border-gray-800 overflow-hidden relative group min-w-0 flex flex-col shadow-sm">
               <div className="absolute top-2 right-2 z-30">
                    <button 
                        onClick={() => setShowCalibration(!showCalibration)}
                        className="p-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 text-xs shadow-sm"
                    >
                        {showCalibration ? 'Done' : 'Calibrate'}
                    </button>
                </div>
                
                {showCalibration && (
                    <div className="absolute top-10 right-2 z-30 bg-white/90 dark:bg-gray-900/90 p-3 rounded border border-gray-200 dark:border-gray-700 w-64 backdrop-blur-sm shadow-xl">
                        <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 uppercase">Map Calibration</div>
                        
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Zoom</span>
                                    <span>{calibration.scale.toFixed(2)}x</span>
                                </div>
                                <input 
                                    type="range" min="0.1" max="3" step="0.01" 
                                    value={calibration.scale}
                                    onChange={(e) => setCalibration({...calibration, scale: parseFloat(e.target.value)})}
                                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            
                            <div>
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Rotate</span>
                                    <span>{calibration.rotation}°</span>
                                </div>
                                <input 
                                    type="range" min="-180" max="180" step="1" 
                                    value={calibration.rotation}
                                    onChange={(e) => setCalibration({...calibration, rotation: parseFloat(e.target.value)})}
                                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Offset X (px)</span>
                                    <span>{calibration.offsetX}</span>
                                </div>
                                <input 
                                    type="range" min="-500" max="500" step="1" 
                                    value={calibration.offsetX}
                                    onChange={(e) => setCalibration({...calibration, offsetX: parseFloat(e.target.value)})}
                                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Offset Y (px)</span>
                                    <span>{calibration.offsetY}</span>
                                </div>
                                <input 
                                    type="range" min="-500" max="500" step="1" 
                                    value={calibration.offsetY}
                                    onChange={(e) => setCalibration({...calibration, offsetY: parseFloat(e.target.value)})}
                                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            
                            <button 
                                onClick={() => setCalibration({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 })}
                                className="w-full py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-500 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}

               <div className="flex-grow relative z-0">
                   <ReplayTrackMap 
                        positions={trackPositions} 
                        currentIndex={currentIndex} 
                        ghostPosition={showGhost ? ghostPosition : null} 
                        backgroundImage="/tracks/thunderhill/map.svg?v=5"
                        calibration={calibration}
                   />
               </div>
            </div>

            {/* Lap Times Panel */}
            <div className="w-64 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col overflow-hidden shadow-sm">
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">Lap Times</h3>

                <div className="flex-grow overflow-y-auto space-y-2 pr-2 custom-scrollbar">


                    {laps.map((lap, i) => {
                        const delta = idealLap ? lap.lapTime - idealLap.lapTime : null;
                        
                        // Check if this is the active lap
                        const isActive = currentFrame && 
                                         currentFrame.time >= lap.frames[0].time && 
                                         currentFrame.time <= lap.frames[lap.frames.length-1].time;

                        return (
                            <div 
                                key={i} 
                                className={`flex justify-between items-center p-2 rounded border transition-colors ${
                                    isActive 
                                        ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-500 shadow-sm ring-1 ring-blue-400/50 dark:ring-blue-500/50' 
                                        : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60 hover:opacity-100'
                                }`}
                            >
                                <span className={`text-sm ${isActive ? 'text-blue-700 dark:text-blue-100 font-bold' : 'text-gray-600 dark:text-gray-400'}`}>
                                    Lap {lap.lapIndex}
                                </span>
                                <div className="flex items-center gap-2">
                                    {showGhost && delta !== null && (
                                        <span className={`text-xs font-mono font-bold ${delta > 0 ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                            {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                                        </span>
                                    )}
                                    <span className={`font-mono ${isActive ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-500 dark:text-gray-300'}`}>
                                        {lap.lapTime.toFixed(3)}s
                                    </span>
                                </div>
                            </div>
                        );
                    })}

                    {laps.length === 0 && !idealLap && (
                        <div className="text-gray-600 text-xs text-center py-4">No completed laps yet</div>
                    )}
                </div>
            </div>
        </div>

        {/* Telemetry Area */}
        <div className={`flex-grow flex flex-col gap-4 min-h-0 relative z-10 ${isStacked ? 'h-auto' : 'overflow-y-auto'}`}>
            <div className="flex-shrink-0 flex flex-col gap-2">
                <div className="flex justify-between items-center mb-2">
                     <div className="text-sm font-bold text-blue-400 tracking-wider">TELEMETRY</div>
                     {showGhost && ghostFrame && (
                         <div className="flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                             <span className="text-xs font-bold text-yellow-500">IDEAL LAP OVERLAY</span>
                         </div>
                     )}
                </div>
                <ReplayGauges
                  frame={currentFrame}
                  getHistory={getHistory}
                  ghostFrame={showGhost ? ghostFrame : null}
                  getGhostHistory={showGhost ? getGhostHistory : undefined}
                  isStacked={isStacked}
                />
            </div>
        </div>
      </div>
    </div>
  );
};
