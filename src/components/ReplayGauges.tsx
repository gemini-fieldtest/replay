import React from 'react';
import { type TelemetryFrame } from '../utils/telemetryParser';

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
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4b5563" strokeWidth="2" />
        <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="text-[10px] fill-gray-400 font-mono font-bold">
          {Math.round(tickValue)}
        </text>
      </g>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="mb-2 text-center relative max-w-[120px]">
        <span className="text-3xl font-bold font-mono text-white inline-block tracking-tight">{Math.round(isNaN(value) ? 0 : value)}</span>
         {ghostValue !== undefined && !isNaN(ghostValue) && (
             <span className="absolute -right-10 top-2 text-sm font-mono text-yellow-500 font-bold ml-2">
                 {Math.round(ghostValue)}
             </span>
         )}
      </div>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          {/* Background Circle */}
          <circle cx={center} cy={center} r={radius - 2} fill="#111827" stroke="#374151" strokeWidth="2" />

          {/* Ticks */}
          {ticks}

          {/* Label */}
          <text x={center} y={center + 30} textAnchor="middle" className="fill-gray-300 text-xs font-bold uppercase tracking-widest">
            {label}
          </text>
          <text x={center} y={center + 45} textAnchor="middle" className="fill-gray-400 text-[10px] font-medium">
            {unit}
          </text>

          {/* Ghost Needle */}
          {ghostNeedleAngle !== null && (
              <g transform={`rotate(${ghostNeedleAngle} ${center} ${center})`}>
                <line x1={center} y1={center} x2={center + radius - 15} y2={center} stroke="#eab308" strokeWidth="3" strokeOpacity="1" strokeLinecap="round" />
              </g>
          )}

          {/* Main Needle */}
          <g transform={`rotate(${needleAngle} ${center} ${center})`}>
            <line x1={center} y1={center} x2={center + radius - 15} y2={center} stroke={color} strokeWidth="4" strokeLinecap="round" />
            <circle cx={center} cy={center} r="6" fill="#1f2937" stroke={color} strokeWidth="2" />
          </g>
        </svg>
      </div>
    </div>
  );
};



interface BarGaugeProps {
  value: number;
  ghostValue?: number;
  max: number;
  label: string;
  color?: string;
}

const BarGauge: React.FC<BarGaugeProps> = ({ value, ghostValue, max, label, color = '#10b981' }) => {
  const percentage = Math.min((value / max) * 100, 100);
  const ghostPercentage = ghostValue !== undefined ? Math.min((ghostValue / max) * 100, 100) : null;

  return (
    <div className="w-full">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-bold text-gray-200 tracking-wide">{label}</span>
        <div className="flex gap-3 font-mono">
            {ghostValue !== undefined && (
                 <span className="text-xs font-bold text-yellow-500">{Math.round(ghostValue)}%</span>
            )}
            <span className="text-sm font-bold text-white">{Math.round(value)}%</span>
        </div>
      </div>
      <div className="w-full bg-gray-900 rounded-full h-5 relative border border-gray-800">
        {/* Ghost Bar */}
        {ghostPercentage !== null && (
             <div
               className="absolute top-0 left-0 h-full rounded-full transition-all duration-100 ease-linear opacity-50 border-r-2 border-yellow-500"
               style={{ width: `${ghostPercentage}%`, backgroundColor: 'rgba(234, 179, 8, 0.2)' }}
             />
        )}
        {/* Main Bar */}
        <div
          className="h-full rounded-full transition-all duration-100 ease-linear relative z-10 shadow-[0_0_10px_rgba(0,0,0,0.3)]"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

interface SteeringWheelProps {
  angle: number;
  ghostAngle?: number;
}

const SteeringWheel: React.FC<SteeringWheelProps> = ({ angle, ghostAngle }) => {
  return (
    <div className="flex flex-col items-center">
      <div className="w-24 h-24 relative flex items-center justify-center">

        {/* Ghost Wheel (Behind) */}
        {ghostAngle !== undefined && (
             <div
                className="absolute inset-0 rounded-full border-4 border-yellow-600/40 w-full h-full flex items-center justify-center transition-transform duration-100 ease-linear"
                style={{ transform: `rotate(${-ghostAngle}deg)` }}
             >
                 <div className="absolute w-full h-2 bg-yellow-600/40"></div>
                 <div className="absolute h-full w-2 bg-yellow-600/40"></div>
                 <div className="absolute top-0 w-2 h-4 bg-yellow-500/60"></div>
             </div>
        )}

        {/* Main Wheel */}
        <div
            className="w-full h-full rounded-full border-4 border-gray-500 absolute flex items-center justify-center transition-transform duration-100 ease-linear z-10 bg-gray-900/50"
            style={{ transform: `rotate(${-angle}deg)` }}
        >
            {/* Spokes */}
            <div className="absolute w-full h-2 bg-gray-500"></div>
            <div className="absolute h-full w-2 bg-gray-500"></div>
            {/* Top Marker */}
            <div className="absolute top-0 w-2 h-4 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
        </div>
      </div>
      <span className="mt-2 text-sm font-bold text-gray-300">STEERING</span>
    </div>
  );
};

interface GForceMeterProps {
  lat: number;
  long: number;
  ghostLat?: number;
  ghostLong?: number;
  max?: number;
}

const GForceMeter: React.FC<GForceMeterProps> = ({ lat, long, ghostLat, ghostLong, max = 2 }) => {
  const normX = (val: number) => 50 + (Math.max(-1, Math.min(1, val / max)) * 50);
  const normY = (val: number) => 50 - (Math.max(-1, Math.min(1, val / max)) * 50);

  const dotX = normX(lat);
  const dotY = normY(long);

  return (
    <div className="w-24 h-24 bg-gray-900 rounded-full border-2 border-gray-600 relative flex items-center justify-center overflow-hidden">
      {/* Crosshairs */}
      <div className="absolute w-full h-px bg-gray-700"></div>
      <div className="absolute h-full w-px bg-gray-700"></div>

      {/* Rings */}
      <div className="absolute w-12 h-12 rounded-full border border-gray-700/50"></div>
      <div className="absolute w-18 h-18 rounded-full border border-gray-700/30"></div>

      {/* Ghost Dot */}
      {ghostLat !== undefined && ghostLong !== undefined && (
          <div
            className="absolute w-2.5 h-2.5 bg-yellow-500 rounded-full transition-all duration-100 ease-linear opacity-80 shadow-[0_0_5px_rgba(234,179,8,0.5)]"
            style={{ left: `${normX(ghostLat)}%`, top: `${normY(ghostLong)}%`, transform: 'translate(-50%, -50%)' }}
          ></div>
      )}

      {/* Dot */}
      <div
        className="absolute w-3 h-3 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)] transition-all duration-100 ease-linear z-10 border border-white/20"
        style={{ left: `${dotX}%`, top: `${dotY}%`, transform: 'translate(-50%, -50%)' }}
      ></div>

      <span className="absolute bottom-1 text-[10px] font-bold text-gray-500">{max}G</span>
    </div>
  );
};



interface TelemetryGraphProps {
  data: number[];
  ghostData?: number[];
  label: string;
  unit: string;
  color: string;
  min?: number;
  max?: number;
  currentValue: number;
}

const TelemetryGraph: React.FC<TelemetryGraphProps> = ({ data, ghostData, label, unit, color, min, max, currentValue }) => {
  if (!data.length) return null;

  const values = data;

  // Determine range
  // Include ghost data in range calculation to avoid clipping
  let allValues = [...values];
  if (ghostData) allValues = [...allValues, ...ghostData];

  // Let's scale to fit both if provided, but default to min/max if preset
  const calcMin = min ?? Math.min(...allValues);
  const calcMax = max ?? Math.max(...allValues);

  const range = calcMax - calcMin || 1;

  const width = 100;
  const height = 40;

  const getPoints = (d: number[]) => d.map((v, i) => {
    const x = d.length > 1 ? (i / (d.length - 1)) * width : width;
    const safeV = isNaN(v) ? calcMin : v;
    const y = height - ((safeV - calcMin) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const points = getPoints(values);
  const ghostPoints = ghostData ? getPoints(ghostData) : null;

  return (
    <div className="flex flex-col bg-gray-900 border border-gray-800 p-2 rounded min-w-[120px] justify-between shadow-sm">
      <div className="flex justify-between items-end mb-1">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-tight">{label}</span>
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {(currentValue ?? 0).toFixed(1)}{unit}
        </span>
      </div>

      <div className="flex-grow relative w-full h-10 overflow-hidden bg-gray-950/30 rounded">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {/* Ghost Line */}
          {ghostPoints && (
              <polyline
                points={ghostPoints}
                fill="none"
                stroke="#eab308"
                strokeWidth="1.5"
                strokeOpacity="0.7"
                vectorEffect="non-scaling-stroke"
              />
          )}

          {/* Main Area */}
          <path
            d={`M 0,${height} ${points} L ${width},${height} Z`}
            fill={color}
            fillOpacity="0.15"
            stroke="none"
          />
          {/* Main Line */}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};

interface ReplayGaugesProps {
  frame: TelemetryFrame | null;
  getHistory: () => TelemetryFrame[];
  ghostFrame?: TelemetryFrame | null;
  getGhostHistory?: () => TelemetryFrame[];
  isStacked?: boolean;
}

export const ReplayGauges: React.FC<ReplayGaugesProps> = ({ frame, getHistory, ghostFrame, getGhostHistory, isStacked = false }) => {
  if (!frame) return <div className="text-gray-500">No Data</div>;

  const history = getHistory();
  const ghostHistory = getGhostHistory ? getGhostHistory() : [];

  // Helper to extract data for graphs
  const getData = (source: TelemetryFrame[], key: keyof TelemetryFrame) => source.map(f => f[key] as number);

  // Normalize history lengths for graph: if ghost has more/less history points, we might need to be careful?
  // Current implementation of TelemetryGraph just stretches points to width (0 to 100).
  // This is fine for comparison as long as the time window is roughly similar (which it should be, ~60s of history).

  return (
    <div className="bg-gray-950/80 p-6 rounded-lg border border-gray-800 flex flex-col gap-6 shadow-xl">
      {/* Top Row: Speed, Steering, RPM */}
      <div className="flex justify-between items-center px-4">
        <AnalogGauge
          value={frame.speed}
          ghostValue={ghostFrame?.speed}
          max={200}
          label="Speed"
          unit="km/h"
          color="#3b82f6"
        />

        <div className={`flex items-center ${isStacked ? 'flex-row gap-12' : 'flex-col gap-4'}`}>
          <SteeringWheel angle={frame.steering} ghostAngle={ghostFrame?.steering} />
          <div className="flex flex-col items-center">
             <GForceMeter
                lat={frame.gForceLat}
                long={frame.gForceLong}
                ghostLat={ghostFrame?.gForceLat}
                ghostLong={ghostFrame?.gForceLong}
             />
             <div className="flex gap-2 mt-1 text-[10px] font-mono text-gray-400">
              <span>L:{frame.gForceLat?.toFixed(1) ?? '0.0'}</span>
              <span>Lo:{frame.gForceLong?.toFixed(1) ?? '0.0'}</span>
            </div>
          </div>
        </div>

        <AnalogGauge
          value={frame.rpm}
          ghostValue={ghostFrame?.rpm}
          max={8000}
          label="RPM"
          unit="rpm"
          color="#f59e0b"
        />
      </div>

      {/* Middle Row: Pedals */}
      <div className="flex gap-6 items-center px-12">
        <div className="flex-grow flex flex-col gap-2">
           <BarGauge
            value={frame.throttle}
            ghostValue={ghostFrame?.throttle}
            max={100}
            label="Throttle"
            color="#10b981"
          />
        </div>
        <div className="flex-grow flex flex-col gap-2">
          <div className="flex justify-between items-end mb-1">
             <span className="text-sm font-bold text-gray-200 tracking-wide">Brake</span>
             <div className="flex gap-2 font-mono">
                 {ghostFrame && <span className="text-xs font-bold text-yellow-500">{ghostFrame.brakePressure?.toFixed(1)} bar</span>}
                 <span className="text-sm font-bold text-gray-400">{frame.brakePressure?.toFixed(1) ?? '0.0'} bar</span>
             </div>
          </div>
          <div className="w-full bg-gray-900 rounded-full h-5 relative border border-gray-800">
             {ghostFrame && (
                  <div
                    className="absolute top-0 left-0 h-full rounded-full transition-all duration-100 ease-linear opacity-50 border-r-2 border-yellow-500"
                    style={{ width: `${Math.min(ghostFrame.brake * 100, 100)}%`, backgroundColor: 'rgba(234, 179, 8, 0.2)' }}
                  />
             )}
            <div
              className="h-full rounded-full transition-all duration-100 ease-linear relative z-10 shadow-[0_0_10px_rgba(0,0,0,0.3)]"
              style={{ width: `${Math.min(frame.brake * 100, 100)}%`, backgroundColor: '#ef4444' }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Row: G-Force and Mechanics */}
      <div className="flex gap-4 h-40">
        <div className="flex flex-col items-center bg-gray-900 border border-gray-800 p-3 rounded h-full justify-center flex-1 min-w-[120px] shadow-sm">
          <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-tight">Gear</div>
          <div className="text-5xl font-bold text-white mb-2 relative font-mono">
              {frame.gear === 0 ? 'N' : frame.gear}
              {ghostFrame && ghostFrame.gear !== frame.gear && (
                  <span className="absolute -top-1 -right-4 text-lg text-yellow-500 font-bold font-mono">
                      {ghostFrame.gear === 0 ? 'N' : ghostFrame.gear}
                  </span>
              )}
          </div>
          <div className="w-full h-20">
             <TelemetryGraph
               data={getData(history, 'gear')}
               ghostData={ghostFrame ? getData(ghostHistory, 'gear') : undefined}
               currentValue={frame.gear}
               label=""
               unit=""
               color="#ffffff"
               min={0}
               max={6}
             />
          </div>
        </div>

        <div className="flex flex-col gap-2 h-full flex-1 min-w-[120px]">
           <TelemetryGraph
             data={getData(history, 'gradient')}
             ghostData={ghostFrame ? getData(ghostHistory, 'gradient') : undefined}
             currentValue={frame.gradient}
             label="Gradient"
             unit="%"
             color="#a855f7"
             min={-10}
             max={10}
           />
           <TelemetryGraph
             data={getData(history, 'altitude')}
             ghostData={ghostFrame ? getData(ghostHistory, 'altitude') : undefined}
             currentValue={frame.altitude}
             label="Altitude"
             unit="m"
             color="#3b82f6"
           />
        </div>

        <div className="flex flex-col gap-2 h-full flex-1 min-w-[120px]">
          <TelemetryGraph
             data={getData(history, 'coolantTemp')}
             ghostData={ghostFrame ? getData(ghostHistory, 'coolantTemp') : undefined}
             currentValue={frame.coolantTemp}
             label="Coolant"
             unit="°C"
             color="#06b6d4"
             min={40}
             max={120}
           />
           <TelemetryGraph
             data={getData(history, 'oilTemp')}
             ghostData={ghostFrame ? getData(ghostHistory, 'oilTemp') : undefined}
             currentValue={frame.oilTemp}
             label="Oil Temp"
             unit="°C"
             color="#f97316"
             min={50}
             max={150}
           />
        </div>

        <div className="flex flex-col gap-2 h-full flex-1 min-w-[120px]">
           <TelemetryGraph
             data={getData(history, 'batteryVoltage')}
             ghostData={ghostFrame ? getData(ghostHistory, 'batteryVoltage') : undefined}
             currentValue={frame.batteryVoltage}
             label="Battery"
             unit="V"
             color="#eab308"
             min={11}
             max={15}
           />
           <TelemetryGraph
             data={getData(history, 'fuelLevel')}
             ghostData={ghostFrame ? getData(ghostHistory, 'fuelLevel') : undefined}
             currentValue={frame.fuelLevel}
             label="Fuel"
             unit="%"
             color="#22c55e"
             min={0}
             max={100}
           />
        </div>

        <div className="flex flex-col gap-2 h-full flex-1 min-w-[120px]">
          <TelemetryGraph
             data={getData(history, 'oilPressure')}
             ghostData={ghostFrame ? getData(ghostHistory, 'oilPressure') : undefined}
             currentValue={frame.oilPressure}
             label="Oil Press"
             unit="bar"
             color="#8b5cf6"
             min={0}
             max={10}
           />
           <TelemetryGraph
             data={getData(history, 'comboG')}
             ghostData={ghostFrame ? getData(ghostHistory, 'comboG') : undefined}
             currentValue={frame.comboG}
             label="Combo G"
             unit="G"
             color="#ef4444"
             min={0}
             max={3}
           />
        </div>

        <div className="flex flex-col gap-2 h-full flex-1 min-w-[120px]">
          <TelemetryGraph
             data={getData(history, 'verticalVelocity')}
             ghostData={ghostFrame ? getData(ghostHistory, 'verticalVelocity') : undefined}
             currentValue={frame.verticalVelocity}
             label="Vert Vel"
             unit="km/h"
             color="#ec4899"
             min={-20}
             max={20}
           />
           <TelemetryGraph
             data={getData(history, 'radiusOfTurn')}
             ghostData={ghostFrame ? getData(ghostHistory, 'radiusOfTurn') : undefined}
             currentValue={frame.radiusOfTurn}
             label="Turn Rad"
             unit="m"
             color="#14b8a6"
             min={0}
             max={500}
           />
        </div>
      </div>
    </div>
  );
};
