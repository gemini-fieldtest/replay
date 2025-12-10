import React, { useMemo } from 'react';
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
    <div className="flex-grow flex gap-4 h-full">
      <div className="flex-grow flex flex-col gap-4 h-full">
        <div className="flex gap-4 h-96 shrink-0">
            {/* Track Map */}
            <div className="bg-gray-900 rounded-lg flex-grow border border-gray-800 overflow-hidden relative group min-w-0">
               <ReplayTrackMap positions={trackPositions} currentIndex={currentIndex} ghostPosition={showGhost ? ghostPosition : null} />
            </div>

            {/* Lap Times Panel */}
            <div className="w-64 bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col overflow-hidden">
                <h3 className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">Lap Times</h3>

                <div className="flex-grow overflow-y-auto space-y-2 pr-2 custom-scrollbar">


                    {laps.map((lap, i) => {
                        const delta = idealLap ? lap.lapTime - idealLap.lapTime : null;
                        return (
                            <div key={i} className="flex justify-between items-center p-2 bg-gray-800/50 rounded border border-gray-700">
                                <span className="text-gray-400 text-sm">Lap {lap.lapIndex + 1}</span>
                                <div className="flex items-center gap-2">
                                    {showGhost && delta !== null && (
                                        <span className={`text-xs font-mono font-bold ${delta > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                                        </span>
                                    )}
                                    <span className="text-white font-mono">{lap.lapTime.toFixed(3)}s</span>
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
        <div className="flex-grow flex flex-col gap-4 min-h-0 overflow-y-auto">
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
