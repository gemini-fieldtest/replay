import React, { useState } from 'react';
import { Map as MapIcon, MapPinOff } from 'lucide-react';
import { RealtimeGauges } from '../components/RealtimeGauges';
import { CoordinatesDisplay } from '../components/CoordinatesDisplay';
import { GoogleMapsEmbed } from '../components/GoogleMapsEmbed';
import { TrackMap } from '../components/TrackMap';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { type LapData } from '../utils/lapAnalysis';

interface RealtimePitViewProps {
  currentFrame: TelemetryFrame | null;
  trackPositions: Float32Array;
  currentIndex: number;
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost?: boolean;
  idealLap?: LapData | null;
  laps?: LapData[];
}

export const RealtimePitView: React.FC<RealtimePitViewProps> = ({ 
  currentFrame, 
  trackPositions, 
  currentIndex, 
  ghostFrame,
  ghostPosition,
  showGhost,
  idealLap,
  laps = []
}) => {
  const [showMap, setShowMap] = useState(false);

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
                <div className="flex gap-4 items-start flex-wrap">
                    <RealtimeGauges 
                      frame={currentFrame} 
                    />
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <CoordinatesDisplay
                                latitude={currentFrame?.latitude}
                                longitude={currentFrame?.longitude}
                                label="GPS SIGNAL"
                                color="text-green-400"
                            />
                            <button
                                onClick={() => setShowMap(!showMap)}
                                className={`p-2 rounded-lg border transition-colors ${showMap ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
                                title={showMap ? "Hide Map" : "Show Map"}
                            >
                                {showMap ? <MapPinOff size={20} /> : <MapIcon size={20} />}
                            </button>
                        </div>
                        
                        {showMap && (
                            <GoogleMapsEmbed
                                latitude={currentFrame?.latitude}
                                longitude={currentFrame?.longitude}
                                className="flex-grow"
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Ghost Telemetry */}
            {showGhost && ghostFrame && (
                <div className="flex-shrink-0 flex flex-col gap-2 border-t border-gray-800 pt-4">
                    <div className="text-sm font-bold text-yellow-400 mb-2">IDEAL LAP (GHOST)</div>
                    <RealtimeGauges 
                      frame={ghostFrame} 
                    />
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
