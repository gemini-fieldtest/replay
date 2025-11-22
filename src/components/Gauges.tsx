import React from 'react';
import { type TelemetryFrame } from '../utils/telemetryParser';

interface AnalogGaugeProps {
  value: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
  size?: number;
}

const AnalogGauge: React.FC<AnalogGaugeProps> = ({ 
  value, 
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
  const percentage = Math.min(Math.max(value / max, 0), 1);
  const needleAngle = startAngle + (percentage * angleRange);
  
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
        <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="text-[10px] fill-gray-400 font-mono">
          {Math.round(tickValue)}
        </text>
      </g>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="mb-2 text-center">
        <span className="text-3xl font-bold font-mono text-white">{Math.round(value)}</span>
      </div>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          {/* Background Circle */}
          <circle cx={center} cy={center} r={radius - 2} fill="#111827" stroke="#374151" strokeWidth="2" />
          
          {/* Ticks */}
          {ticks}
          
          {/* Label */}
          <text x={center} y={center + 30} textAnchor="middle" className="fill-gray-400 text-xs uppercase tracking-widest">
            {label}
          </text>
          <text x={center} y={center + 45} textAnchor="middle" className="fill-gray-500 text-[10px]">
            {unit}
          </text>
          
          {/* Needle */}
          <g transform={`rotate(${needleAngle} ${center} ${center})`}>
            <line x1={center} y1={center} x2={center + radius - 15} y2={center} stroke={color} strokeWidth="3" strokeLinecap="round" />
            <circle cx={center} cy={center} r="6" fill="#374151" />
          </g>
        </svg>
      </div>
    </div>
  );
};



interface BarGaugeProps {
  value: number;
  max: number;
  label: string;
  color?: string;
}

const BarGauge: React.FC<BarGaugeProps> = ({ value, max, label, color = '#10b981' }) => {
  const percentage = Math.min((value / max) * 100, 100);
  
  return (
    <div className="w-full">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className="text-sm font-medium text-gray-400">{Math.round(value)}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-4">
        <div 
          className="h-4 rounded-full transition-all duration-100 ease-linear" 
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

interface SteeringWheelProps {
  angle: number;
}

const SteeringWheel: React.FC<SteeringWheelProps> = ({ angle }) => {
  return (
    <div className="flex flex-col items-center">
      <div 
        className="w-24 h-24 rounded-full border-4 border-gray-600 relative flex items-center justify-center transition-transform duration-100 ease-linear"
        style={{ transform: `rotate(${angle}deg)` }}
      >
        {/* Spokes */}
        <div className="absolute w-full h-2 bg-gray-600"></div>
        <div className="absolute h-full w-2 bg-gray-600"></div>
        {/* Top Marker */}
        <div className="absolute top-0 w-2 h-4 bg-red-500"></div>
      </div>
      <span className="mt-2 text-sm font-medium text-gray-300">Steering</span>
    </div>
  );
};

interface GForceMeterProps {
  lat: number;
  long: number;
  max?: number;
}

const GForceMeter: React.FC<GForceMeterProps> = ({ lat, long, max = 2 }) => {
  // Normalize to -1 to 1 range based on max G
  const x = Math.max(-1, Math.min(1, lat / max));
  const y = Math.max(-1, Math.min(1, long / max)); // Positive long G is usually braking (forward weight transfer) or acceleration?
  // Typically:
  // +Long = Acceleration (Dot moves down or up?)
  // -Long = Braking
  // +Lat = Right Turn (Dot moves Left?)
  // Let's assume standard: +Lat = Left Turn (Force to Right), so dot moves Right.
  // Actually, if car turns Left, you feel force to Right.
  // Let's just map directly for now.
  
  // Canvas coordinates: Center is (50, 50) in %
  const dotX = 50 + (x * 50);
  const dotY = 50 - (y * 50); // Invert Y because screen Y is down
  
  return (
    <div className="w-24 h-24 bg-gray-800 rounded-full border-2 border-gray-600 relative flex items-center justify-center overflow-hidden">
      {/* Crosshairs */}
      <div className="absolute w-full h-px bg-gray-700"></div>
      <div className="absolute h-full w-px bg-gray-700"></div>
      
      {/* Rings */}
      <div className="absolute w-12 h-12 rounded-full border border-gray-700"></div>
      
      {/* Dot */}
      <div 
        className="absolute w-3 h-3 bg-red-500 rounded-full shadow-lg transition-all duration-100 ease-linear"
        style={{ left: `${dotX}%`, top: `${dotY}%`, transform: 'translate(-50%, -50%)' }}
      ></div>
      
      <span className="absolute bottom-1 text-[10px] text-gray-500">{max}G</span>
    </div>
  );
};



interface TelemetryGraphProps {
  data: number[];
  label: string;
  unit: string;
  color: string;
  min?: number;
  max?: number;
  currentValue: number;
}

const TelemetryGraph: React.FC<TelemetryGraphProps> = ({ data, label, unit, color, min, max, currentValue }) => {
  if (!data.length) return null;

  const values = data;
  
  // Determine range
  const minValue = min ?? Math.min(...values);
  const maxValue = max ?? Math.max(...values);
  const range = maxValue - minValue || 1; // Avoid divide by zero

  // Generate path
  const width = 100;
  const height = 40;
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * width : width;
    if (isNaN(x)) return `${width},${height}`; // Fallback
    const y = height - ((v - minValue) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="flex flex-col bg-gray-800 p-2 rounded h-full min-w-[120px] justify-between">
      <div className="flex justify-between items-end mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {currentValue.toFixed(1)}{unit}
        </span>
      </div>
      
      <div className="flex-grow relative w-full h-10 overflow-hidden">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <path
            d={`M 0,${height} ${points} L ${width},${height} Z`}
            fill={color}
            fillOpacity="0.2"
            stroke="none"
          />
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
};

interface GaugesProps {
  frame: TelemetryFrame | null;
  getHistory: () => TelemetryFrame[];
}

export const Gauges: React.FC<GaugesProps> = ({ frame, getHistory }) => {
  if (!frame) return <div className="text-gray-500">No Data</div>;

  const history = getHistory();

  // Helper to extract data for graphs
  const getData = (key: keyof TelemetryFrame) => history.map(f => f[key] as number);

  return (
    <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 flex flex-col gap-6">
      {/* Top Row: Speed, Steering, RPM */}
      <div className="flex justify-between items-center px-4">
        <AnalogGauge 
          value={frame.speed} 
          max={200} 
          label="Speed" 
          unit="km/h" 
          color="#3b82f6" 
        />
        
        <div className="flex flex-col items-center gap-4">
          <SteeringWheel angle={frame.steering} />
          <div className="flex flex-col items-center">
             <GForceMeter lat={frame.gForceLat} long={frame.gForceLong} />
             <div className="flex gap-2 mt-1 text-[10px] text-gray-400">
              <span>L:{frame.gForceLat.toFixed(1)}</span>
              <span>Lo:{frame.gForceLong.toFixed(1)}</span>
            </div>
          </div>
        </div>
        
        <AnalogGauge 
          value={frame.rpm} 
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
            max={100} 
            label="Throttle" 
            color="#10b981" 
          />
        </div>
        <div className="flex-grow flex flex-col gap-2">
          <div className="flex justify-between items-end mb-1">
             <span className="text-sm font-medium text-gray-300">Brake</span>
             <span className="text-xs text-gray-500">{frame.brakePressure.toFixed(1)} bar</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-4">
            <div 
              className="h-4 rounded-full transition-all duration-100 ease-linear" 
              style={{ width: `${Math.min(frame.brake * 100, 100)}%`, backgroundColor: '#ef4444' }}
            />
          </div>
        </div>
      </div>
      
      {/* Bottom Row: G-Force and Mechanics */}
      <div className="flex gap-4 h-40">
        <div className="flex flex-col items-center bg-gray-800 p-3 rounded h-full justify-center w-40">
          <div className="text-xs text-gray-400 mb-1">Gear</div>
          <div className="text-4xl font-bold text-white mb-2">{frame.gear === 0 ? 'N' : frame.gear}</div>
          <div className="w-full h-20">
             <TelemetryGraph 
               data={getData('gear')} 
               currentValue={frame.gear}
               label="" 
               unit="" 
               color="#ffffff" 
               min={0}
               max={6}
             />
          </div>
        </div>
        
        <div className="flex flex-col gap-2 h-full w-40">
           <TelemetryGraph 
             data={getData('gradient')} 
             currentValue={frame.gradient}
             label="Gradient" 
             unit="%" 
             color="#a855f7" 
             min={-10} 
             max={10} 
           />
           <TelemetryGraph 
             data={getData('altitude')} 
             currentValue={frame.altitude}
             label="Altitude" 
             unit="m" 
             color="#3b82f6" 
           />
        </div>
        
        <div className="flex flex-col gap-2 h-full w-40">
          <TelemetryGraph 
             data={getData('coolantTemp')} 
             currentValue={frame.coolantTemp}
             label="Coolant" 
             unit="°C" 
             color="#06b6d4" 
             min={40}
             max={120}
           />
           <TelemetryGraph 
             data={getData('oilTemp')} 
             currentValue={frame.oilTemp}
             label="Oil Temp" 
             unit="°C" 
             color="#f97316" 
             min={50}
             max={150}
           />
        </div>
        
        <div className="flex flex-col gap-2 h-full w-40">
           <TelemetryGraph 
             data={getData('batteryVoltage')} 
             currentValue={frame.batteryVoltage}
             label="Battery" 
             unit="V" 
             color="#eab308" 
             min={11}
             max={15}
           />
           <TelemetryGraph 
             data={getData('fuelLevel')} 
             currentValue={frame.fuelLevel}
             label="Fuel" 
             unit="%" 
             color="#22c55e" 
             min={0}
             max={100}
           />
        </div>

        <div className="flex flex-col gap-2 h-full w-40">
          <TelemetryGraph 
             data={getData('oilPressure')} 
             currentValue={frame.oilPressure}
             label="Oil Press" 
             unit="bar" 
             color="#8b5cf6" 
             min={0}
             max={10}
           />
           <TelemetryGraph 
             data={getData('comboG')} 
             currentValue={frame.comboG}
             label="Combo G" 
             unit="G" 
             color="#ef4444" 
             min={0}
             max={3}
           />
        </div>

        <div className="flex flex-col gap-2 h-full w-40">
          <TelemetryGraph 
             data={getData('verticalVelocity')} 
             currentValue={frame.verticalVelocity}
             label="Vert Vel" 
             unit="km/h" 
             color="#ec4899" 
             min={-20}
             max={20}
           />
           <TelemetryGraph 
             data={getData('radiusOfTurn')} 
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
