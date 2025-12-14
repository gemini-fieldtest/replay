import React from 'react';
import { type TelemetryFrame } from '../utils/telemetryParser';
import { useTheme } from '../components/ThemeProvider';

interface AnalogGaugeProps {
  value: number;
  ghostValue?: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
  size?: number;
}

const AnalogGauge: React.FC<AnalogGaugeProps> = ({
  value,
  ghostValue,
  max,
  label,
  unit,
  color = '#3b82f6',
  size = 160
}) => {
  const { theme } = useTheme(); 
  const radius = size / 2;
  const center = size / 2;
  const startAngle = 135;
  const endAngle = 405; // 270 degrees total
  const angleRange = endAngle - startAngle;

  // Calculate needle angle
  const safeValue = isNaN(value) ? 0 : value;
  const percentage = Math.min(Math.max(safeValue / max, 0), 1);
  const needleAngle = startAngle + (percentage * angleRange);

  // Calculate ghost needle angle
  let ghostNeedleAngle = null;
  if (ghostValue !== undefined && !isNaN(ghostValue)) {
      const ghostPercentage = Math.min(Math.max(ghostValue / max, 0), 1);
      ghostNeedleAngle = startAngle + (ghostPercentage * angleRange);
  }

  // Generate ticks
  const ticks = [];
  const numTicks = 11; // 0 to 10
  for (let i = 0; i < numTicks; i++) {
    const tickValue = (max / (numTicks - 1)) * i;
    const tickAngle = startAngle + (i / (numTicks - 1)) * angleRange;
    const rad = (tickAngle * Math.PI) / 180;

    const innerR = radius - 20;
    const outerR = radius - 10;

    const x1 = center + innerR * Math.cos(rad);
    const y1 = center + innerR * Math.sin(rad);
    const x2 = center + outerR * Math.cos(rad);
    const y2 = center + outerR * Math.sin(rad);

    // Text position
    const textR = radius - 35;
    const tx = center + textR * Math.cos(rad);
    const ty = center + textR * Math.sin(rad);

    ticks.push(
      <g key={i}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={theme === 'dark' ? "#4b5563" : "#d1d5db"} strokeWidth="2" />
        <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className={`text-[10px] ${theme === 'dark' ? 'fill-gray-400' : 'fill-gray-500'} font-mono font-bold`}>
          {Math.round(tickValue)}
        </text>
      </g>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="mb-2 text-center relative max-w-[120px]">
        <span className="text-3xl font-bold font-mono text-gray-900 dark:text-white inline-block tracking-tight">{Math.round(isNaN(value) ? 0 : value)}</span>
         {ghostValue !== undefined && !isNaN(ghostValue) && (
             <span className="absolute -right-10 top-2 text-sm font-mono text-yellow-600 dark:text-yellow-500 font-bold ml-2">
                 {Math.round(ghostValue)}
             </span>
         )}
      </div>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          {/* Background Circle */}
          <circle cx={center} cy={center} r={radius - 2} fill={theme === 'dark' ? "#111827" : "#f3f4f6"} stroke={theme === 'dark' ? "#374151" : "#e5e7eb"} strokeWidth="2" />

          {/* Ticks */}
          {ticks}

          {/* Label */}
          <text x={center} y={center + 30} textAnchor="middle" className={`${theme === 'dark' ? 'fill-gray-300' : 'fill-gray-600'} text-xs font-bold uppercase tracking-widest`}>
            {label}
          </text>
          <text x={center} y={center + 45} textAnchor="middle" className={`${theme === 'dark' ? 'fill-gray-400' : 'fill-gray-500'} text-[10px] font-medium`}>
            {unit}
          </text>

          {/* Ghost Needle */}
          {ghostNeedleAngle !== null && (
              <g transform={`rotate(${ghostNeedleAngle} ${center} ${center})`}>
                <line x1={center} y1={center} x2={center + radius - 15} y2={center} stroke={theme === 'dark' ? "#eab308" : "#ca8a04"} strokeWidth="3" strokeOpacity="1" strokeLinecap="round" />
              </g>
          )}

          {/* Main Needle */}
          <g transform={`rotate(${needleAngle} ${center} ${center})`}>
            <line x1={center} y1={center} x2={center + radius - 15} y2={center} stroke={color} strokeWidth="4" strokeLinecap="round" />
            <circle cx={center} cy={center} r="6" fill={theme === 'dark' ? "#1f2937" : "#fff"} stroke={color} strokeWidth="2" />
          </g>
        </svg>
      </div>
    </div>
  );
};

interface RealtimeGaugesProps {
  frame: TelemetryFrame | null;
  ghostFrame?: TelemetryFrame | null;
}

export const RealtimeGauges: React.FC<RealtimeGaugesProps> = ({ frame, ghostFrame }) => {
  if (!frame) return <div className="text-gray-500">No Data</div>;

  return (
    <div className="bg-white dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-800 flex flex-col items-center gap-6">
      <AnalogGauge 
        value={frame.speed} 
        ghostValue={ghostFrame?.speed}
        max={200} 
        label="Speed" 
        unit="km/h" 
        color="#3b82f6"
        size={240}
      />
    </div>
  );
};
