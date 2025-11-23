import React, { useMemo } from 'react';
import { Gauges } from '../components/Gauges';
import { TrackMap } from '../components/TrackMap';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { type LapData } from '../utils/lapAnalysis';

interface PitViewProps {
  currentFrame: TelemetryFrame | null;
  trackPositions: Float32Array;
  currentIndex: number;
  getHistory: () => TelemetryFrame[];
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost?: boolean;
  idealLap?: LapData | null;
  laps?: LapData[];
}

export const PitView: React.FC<PitViewProps> = ({ 
  currentFrame, 
  trackPositions, 
  currentIndex, 
  getHistory,
  ghostFrame,
  ghostPosition,
  showGhost,
  idealLap,
  laps = []
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
               <TrackMap positions={trackPositions} currentIndex={currentIndex} ghostPosition={ghostPosition} />
            </div>

            {/* Lap Times Panel */}
            <div className="w-64 bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col overflow-hidden">
                <h3 className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">Lap Times</h3>
                
                <div className="flex-grow overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {idealLap && (
                        <div className="flex justify-between items-center p-2 bg-yellow-900/20 border border-yellow-700/50 rounded">
                            <span className="text-yellow-500 font-medium text-sm">Ideal Lap</span>
                            <span className="text-yellow-400 font-mono font-bold">{idealLap.lapTime.toFixed(3)}s</span>
                        </div>
                    )}
                    
                    {laps.map((lap, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-gray-800/50 rounded border border-gray-700">
                            <span className="text-gray-400 text-sm">Lap {lap.lapIndex + 1}</span>
                            <span className="text-white font-mono">{lap.lapTime.toFixed(3)}s</span>
                        </div>
                    ))}
                    
                    {laps.length === 0 && !idealLap && (
                        <div className="text-gray-600 text-xs text-center py-4">No completed laps yet</div>
                    )}
                </div>
            </div>
        </div>
        
        {/* Telemetry Area */}
        <div className="flex-grow flex flex-col gap-4 min-h-0 overflow-y-auto">
            {/* Current Telemetry */}
            <div className="flex-shrink-0 flex flex-col gap-2">
                <div className="text-sm font-bold text-blue-400 mb-2">CURRENT LAP</div>
                <Gauges 
                  frame={currentFrame} 
                  getHistory={getHistory}
                />
            </div>

            {/* Ghost Telemetry */}
            {showGhost && ghostFrame && (
                <div className="flex-shrink-0 flex flex-col gap-2 border-t border-gray-800 pt-4">
                    <div className="text-sm font-bold text-yellow-400 mb-2">IDEAL LAP (GHOST)</div>
                    <Gauges 
                      frame={ghostFrame} 
                      getHistory={getGhostHistory}
                    />
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
