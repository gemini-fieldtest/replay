import React from 'react';
import { Gauges } from '../components/Gauges';
import { TrackMap } from '../components/TrackMap';
import { type TelemetryFrame } from '../utils/telemetryParser';

interface PitViewProps {
  currentFrame: TelemetryFrame | null;
  trackPositions: Float32Array;
  currentIndex: number;
  getHistory: () => TelemetryFrame[];
}

export const PitView: React.FC<PitViewProps> = ({ 
  currentFrame, 
  trackPositions, 
  currentIndex, 
  getHistory 
}) => {
  return (
    <div className="flex-grow flex gap-4 h-full">
      <div className="flex-grow flex flex-col gap-4 h-full">
        {/* Track Map */}
        <div className="bg-gray-900 rounded-lg h-96 border border-gray-800 overflow-hidden relative group">
           <TrackMap positions={trackPositions} currentIndex={currentIndex} />
        </div>
        
        <Gauges 
          frame={currentFrame} 
          getHistory={getHistory}
        />
      </div>
    </div>
  );
};
