import React from 'react';
import { TrackMap3D } from '../components/TrackMap3D';
import type { TelemetryFrame } from '../utils/telemetryParser';

interface DriverViewProps {
  positions: Float32Array;
  currentIndex: number;
  currentFrame: TelemetryFrame | null;
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost: boolean;
  setShowGhost: (show: boolean) => void;
  startLinePos?: [number, number, number] | null;
}

export const DriverView: React.FC<DriverViewProps> = ({ positions, currentIndex, currentFrame, ghostFrame, ghostPosition, showGhost, setShowGhost, startLinePos }) => {
  return (
    <div className="flex-grow bg-gray-900 flex flex-col min-h-0">
      <div className="flex-grow relative min-h-0">
        <TrackMap3D 
            positions={positions} 
            currentIndex={currentIndex} 
            currentFrame={currentFrame} 
            ghostFrame={ghostFrame}
            ghostPosition={ghostPosition}
            showGhost={showGhost}
            setShowGhost={setShowGhost}
            startLinePos={startLinePos}
        />
      </div>
    </div>
  );
};
