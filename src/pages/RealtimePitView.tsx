import React, { useState, useMemo } from 'react';
import { Map as MapIcon, MapPinOff } from 'lucide-react';

import { RealtimeGauges } from '../components/RealtimeGauges';
import { CoordinatesDisplay } from '../components/CoordinatesDisplay';
import { GoogleMapsEmbed } from '../components/GoogleMapsEmbed';
import { RealtimeTrackMap } from '../components/RealtimeTrackMap';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { type LapData } from '../utils/lapAnalysis';

interface Sector {
  id: string;
  name: string;
  shortName: string;
  color: string;
  startRatio: number;
  endRatio: number;
}

interface RealtimePitViewProps {
  currentFrame: TelemetryFrame | null;
  positions: Float32Array; 
  currentIndex: number;
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  carPosition?: [number, number, number] | null;
  showGhost?: boolean;
  idealLap?: LapData | null;
  laps?: LapData[];
}

export const RealtimePitView: React.FC<RealtimePitViewProps> = ({ 
  currentFrame, 
  positions: trackPositions, 
  currentIndex, 
  ghostFrame,
  ghostPosition,
  carPosition,
  showGhost,
  idealLap,
  laps = []
}) => {
  const [showMap, setShowMap] = useState(false);
  const [sectors] = useState<Sector[]>([]);
  const [calibration, setCalibration] = useState({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0
  });

  const [showCalibration, setShowCalibration] = useState(false);

  // Load Sectors


  // Calculate Current Sector
  const currentSector = useMemo(() => {
      if (!trackPositions || trackPositions.length === 0 || sectors.length === 0) return null;
      // Calculate progress ratio (0 to 1)
      const totalPoints = trackPositions.length / 3;
      const progress = currentIndex / totalPoints;
      
      const ratio = Math.max(0, Math.min(1, progress));
      return sectors.find(s => ratio >= s.startRatio && ratio < s.endRatio) || sectors[sectors.length - 1];
  }, [currentIndex, trackPositions, sectors]);

  return (
    <div className="flex-grow flex gap-4 h-full overflow-hidden">
        {/* Track Map - Full Height, Flexible Width */}
        <div className="flex-grow bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 relative overflow-hidden group min-w-0 flex flex-col h-full">
            <div className="absolute top-2 right-2 z-10">
                <button 
                    onClick={() => setShowCalibration(!showCalibration)}
                    className="p-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 text-xs shadow-sm"
                >
                    {showCalibration ? 'Done' : 'Calibrate'}
                </button>
            </div>
            
            {showCalibration && (
                <div className="absolute top-10 right-2 z-10 bg-white/90 dark:bg-gray-900/90 p-3 rounded border border-gray-200 dark:border-gray-700 w-64 backdrop-blur-sm shadow-xl">
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
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
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
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
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
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
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
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                        
                        <button 
                            onClick={() => setCalibration({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 })}
                            className="w-full py-1 text-xs bg-red-900/30 text-red-500 rounded hover:bg-red-900/50"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-grow relative">
                <RealtimeTrackMap 
                    positions={trackPositions} 
                    currentIndex={currentIndex} 
                    ghostPosition={ghostPosition}
                    carPosition={carPosition}
                    backgroundImage="/tracks/thunderhill/map.svg?v=4"
                    calibration={calibration}
                />
            </div>
        </div>

        {/* Sidebar - Fixed Width */}
        <div className="w-[400px] flex flex-col gap-4 shrink-0 h-full overflow-y-auto custom-scrollbar">
            
            {/* 1. GPS Signal */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 shadow-sm">
                <CoordinatesDisplay
                    latitude={currentFrame?.latitude}
                    longitude={currentFrame?.longitude}
                    label="GPS SIGNAL"
                    color="text-green-400"
                />
            </div>

            {/* 2. Current Telemetry & Gauges */}
            <div className="flex flex-col gap-2">
                <div className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase">Current Lap</div>
                <RealtimeGauges 
                  frame={currentFrame}
                  ghostFrame={showGhost ? ghostFrame : null}
                />
            </div>

            {/* 3. Maps */}
             <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 flex flex-col gap-2 shadow-sm">
                 <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-500 uppercase">Track Map</span>
                    <button
                        onClick={() => setShowMap(!showMap)}
                        className={`p-1.5 rounded-lg border transition-colors ${showMap ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                        title={showMap ? "Hide Map" : "Show Map"}
                    >
                        {showMap ? <MapPinOff size={16} /> : <MapIcon size={16} />}
                    </button>
                 </div>
                 {showMap && (
                    <GoogleMapsEmbed
                        latitude={currentFrame?.latitude}
                        longitude={currentFrame?.longitude}
                        className="h-48 w-full rounded"
                    />
                )}
            </div>

            {/* 4. Lap Times Panel (Bottom) */}
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col shrink-0 h-40 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lap Times</h3>
                    {currentSector && (
                      <span className="px-2 py-0.5 rounded text-xs font-bold text-gray-900" style={{ backgroundColor: currentSector.color }}>
                        {currentSector.id}
                      </span>
                    )}
                </div>
                
                <div className="flex-grow overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {/* Show all laps, restricted by height */}
                    {[...laps].reverse().map((lap) => {
                        const delta = idealLap ? lap.lapTime - idealLap.lapTime : null;
                        return (
                            <div key={lap.lapIndex} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
                                <span className="text-gray-600 dark:text-gray-400 text-sm">Lap {lap.lapIndex}</span>
                                <div className="flex items-center gap-2">
                                    {showGhost && delta !== null && (
                                        <span className={`text-xs font-mono font-bold ${delta > 0 ? 'text-red-600 dark:text-red-500' : 'text-green-600 dark:text-green-500'}`}>
                                            {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                                        </span>
                                    )}
                                    <span className="text-gray-900 dark:text-white font-mono">{lap.lapTime.toFixed(3)}s</span>
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
    </div>
  );
};
