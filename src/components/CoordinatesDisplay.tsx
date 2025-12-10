import React from 'react';

interface CoordinatesDisplayProps {
  latitude?: number;
  longitude?: number;
  label?: string;
  color?: string; // Optional accent color
}

export const CoordinatesDisplay: React.FC<CoordinatesDisplayProps> = ({ 
  latitude, 
  longitude,
  label = "GPS Coordinates",
  color = "text-blue-400" 
}) => {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col gap-2 min-w-[180px]">
      <div className={`text-xs font-bold uppercase tracking-wider ${color} flex items-center justify-between`}>
          <span>{label}</span>
          <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      </div>
      
      <div className="flex flex-col gap-1 font-mono text-sm">
        <div className="flex justify-between items-center group">
            <span className="text-gray-500 text-[10px] uppercase">Lat</span>
            <span className="text-white tabular-nums tracking-tight">
                {latitude?.toFixed(6) ?? '---.------'}
            </span>
        </div>
        
        <div className="w-full h-px bg-gray-800/50" />
        
        <div className="flex justify-between items-center group">
            <span className="text-gray-500 text-[10px] uppercase">Lon</span>
            <span className="text-white tabular-nums tracking-tight">
                {longitude?.toFixed(6) ?? '---.------'}
            </span>
        </div>
      </div>
    </div>
  );
};
