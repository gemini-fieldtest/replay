import React from 'react';
import type { TelemetryFrame } from '../utils/telemetryParser';

interface ReplayHUDProps {
  currentFrame: TelemetryFrame | null;
}

export const ReplayHUD: React.FC<ReplayHUDProps> = ({ currentFrame }) => {
  if (!currentFrame) return null;

  return (
    <div className="absolute top-4 right-4 z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-900 dark:text-white flex flex-col gap-2 shadow-xl min-w-[140px]">
      <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-1 mb-1">
        <span className="text-gray-500 dark:text-gray-400 font-semibold">TELEMETRY</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500 dark:text-gray-400">Speed</span>
        <span className="font-bold text-blue-600 dark:text-blue-400 text-lg">{currentFrame.speed?.toFixed(0) ?? '0'} <span className="text-xs text-gray-500 dark:text-gray-500">km/h</span></span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500 dark:text-gray-400">G-Lat</span>
        <span className={`font-bold ${Math.abs(currentFrame.gForceLat ?? 0) > 0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
          {currentFrame.gForceLat?.toFixed(2) ?? '0.00'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500 dark:text-gray-400">G-Long</span>
        <span className={`font-bold ${Math.abs(currentFrame.gForceLong ?? 0) > 0.5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'}`}>
          {currentFrame.gForceLong?.toFixed(2) ?? '0.00'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500 dark:text-gray-400">Slope</span>
        <span className="font-bold text-green-600 dark:text-green-400">{currentFrame.gradient?.toFixed(1) ?? '0.0'}%</span>
      </div>
    </div>
  );
};
