import React, { useRef, useEffect, useMemo } from 'react';
import { useTheme } from './ThemeProvider';

interface ReplayTrackMapProps {
  positions: Float32Array;
  currentIndex: number;
  ghostPosition?: [number, number, number] | null;
  carPosition?: [number, number, number] | null;
  backgroundImage?: string;
  calibration?: {
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
  };
}

export const ReplayTrackMap: React.FC<ReplayTrackMapProps> = ({ 
  positions, 
  currentIndex, 
  ghostPosition, 
  carPosition,
  backgroundImage,
  calibration = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } 
}) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate bounds from positions (X and Z)
  const bounds = useMemo(() => {
    if (!positions || positions.length === 0) return null;
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    return { minX, maxX, minZ, maxZ };
  }, [positions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds || !positions || positions.length === 0) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle high DPI displays
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      if (rect.width === 0 || rect.height === 0) return;

      // Set actual size in memory
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Normalize coordinate system
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      
      ctx.clearRect(0, 0, width, height);

      // Padding - minimal padding to maximize SVG usage
      const padding = 20; 
      const drawWidth = width - padding * 2;
      const drawHeight = height - padding * 2;

      // Calculate scale
      const rangeX = bounds.maxX - bounds.minX;
      const rangeZ = bounds.maxZ - bounds.minZ;
      
      if (rangeX === 0 || rangeZ === 0) return;

      // We want to fit the track into the box
      const scaleX = drawWidth / rangeX;
      const scaleZ = drawHeight / rangeZ;
      const scale = Math.min(scaleX, scaleZ);

      // Center the map
      const offsetX = (drawWidth - rangeX * scale) / 2 + padding;
      const offsetY = (drawHeight - rangeZ * scale) / 2 + padding;

      // Project local coordinates to canvas coordinates
      const project = (xLocal: number, zLocal: number) => {
        // 1. Initial Projection to fit canvas
        let x = (xLocal - bounds.minX) * scale + offsetX;
        let y = (zLocal - bounds.minZ) * scale + offsetY;
        
        // 2. Apply Calibration
        // Transform around center
        const cx = width / 2;
        const cy = height / 2;

        // Translate to origin
        let dx = x - cx;
        let dy = y - cy;

        // Scale
        dx *= calibration.scale;
        dy *= calibration.scale;

        // Rotate
        if (calibration.rotation !== 0) {
            const rad = calibration.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const rdx = dx * cos - dy * sin;
            const rdy = dx * sin + dy * cos;
            dx = rdx;
            dy = rdy;
        }

        // Translate back + Offset
        x = cx + dx + calibration.offsetX;
        y = cy + dy + calibration.offsetY;
        
        return { x, y };
      };

      // Draw Track
      if (!backgroundImage) {
          ctx.beginPath();
          ctx.strokeStyle = '#3b82f6'; // blue-500
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const start = project(positions[0], positions[2]);
          ctx.moveTo(start.x, start.y);

          for (let i = 3; i < positions.length; i += 3) {
            const { x, y } = project(positions[i], positions[i + 2]);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
      } else {
          // Debug alignment line - very faint
          ctx.beginPath();
          ctx.strokeStyle = theme === 'dark' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.5)'; // blue-500 with low opacity
          ctx.lineWidth = 1;
          
          const start = project(positions[0], positions[2]);
          ctx.moveTo(start.x, start.y);

          for (let i = 3; i < positions.length; i += 3) {
            const { x, y } = project(positions[i], positions[i + 2]);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
      }

      // Start/Finish Line
      const startPos = project(positions[0], positions[2]);
      
      ctx.beginPath();
      ctx.fillStyle = theme === 'dark' ? '#ffffff' : '#111827';
      ctx.arc(startPos.x, startPos.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw "0" label at Start
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = theme === 'dark' ? '#ffffff' : '#111827';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('0', startPos.x, startPos.y - 12);

      // Draw Ghost Marker
      if (ghostPosition) {
        const { x, y } = project(ghostPosition[0], ghostPosition[2]);
        
        ctx.beginPath();
        ctx.fillStyle = theme === 'dark' ? '#fbbf24' : '#d97706'; // amber-400 (Gold) or amber-600
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#000000';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw Car Marker
      let cx: number | null = null;
      let cz: number | null = null;

      if (carPosition) {
        cx = carPosition[0];
        cz = carPosition[2];
      } else {
        const carIndex = currentIndex * 3;
        if (carIndex < positions.length) {
          cx = positions[carIndex];
          cz = positions[carIndex + 2];
        }
      }

      if (cx !== null && cz !== null) {
        const { x, y } = project(cx, cz);
        
        ctx.beginPath();
        ctx.fillStyle = '#ef4444'; // red-500
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#000000';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    // Initial draw
    draw();

    // Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      draw();
    });

    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
    
  }, [bounds, positions, currentIndex, ghostPosition, carPosition, backgroundImage, calibration, theme]);


  return (
    <div ref={containerRef} className="relative w-full h-full min-w-0 min-h-0 bg-gray-50 dark:bg-transparent rounded-lg">
        {backgroundImage && (
            <img 
                src={backgroundImage} 
                alt="Track Map" 
                className="absolute inset-0 w-full h-full object-contain p-5"
                style={{ filter: theme === 'dark' ? 'brightness(0) invert(1)' : 'none' }}
            />
        )}
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 w-full h-full block"
        />
    </div>
  );
};
