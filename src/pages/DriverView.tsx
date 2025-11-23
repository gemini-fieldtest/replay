import React, { useMemo } from 'react';
import { TrackMap3D } from '../components/TrackMap3D';
import type { TelemetryFrame } from '../utils/telemetryParser';

interface DriverViewProps {
  telemetryData: TelemetryFrame[];
  currentTime: number;
  currentFrame: TelemetryFrame | null;
}

export const DriverView: React.FC<DriverViewProps> = ({ telemetryData, currentTime, currentFrame }) => {
  const positions = useMemo(() => {
    const pos = new Float32Array(telemetryData.length * 3);
    if (telemetryData.length === 0) return pos; // Handle empty data case

    const initialLongitude = telemetryData[0].longitude;
    const initialLatitude = telemetryData[0].latitude;

    telemetryData.forEach((frame, i) => {
      pos[i * 3] = (frame.longitude - initialLongitude) * 100000;
      pos[i * 3 + 1] = frame.altitude;
      pos[i * 3 + 2] = (frame.latitude - initialLatitude) * 100000;
    });
    return pos;
  }, [telemetryData]);

  const currentIndex = useMemo(() => {
    return telemetryData.findIndex(f => f.time >= currentTime);
  }, [telemetryData, currentTime]);

  return (
    <div className="flex-grow bg-gray-900 flex flex-col min-h-0">
      <div className="flex-grow relative min-h-0">
        <TrackMap3D positions={positions} currentIndex={currentIndex} currentFrame={currentFrame} />
      </div>
    </div>
  );
};
