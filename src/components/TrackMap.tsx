import React, { useRef, useEffect, useMemo } from 'react';

interface TrackMapProps {
  positions: Float32Array;
  currentIndex: number;
  ghostPosition?: [number, number, number] | null;
}

export const TrackMap: React.FC<TrackMapProps> = ({ positions, currentIndex, ghostPosition }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate bounds from positions (X and Z)
  const bounds = useMemo(() => {
    if (positions.length === 0) return null;
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
    if (!canvas || !bounds || positions.length === 0) return;

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

      // Padding
      const padding = 40;
      const drawWidth = width - padding * 2;
      const drawHeight = height - padding * 2;

      // Calculate scale
      const rangeX = bounds.maxX - bounds.minX;
      const rangeZ = bounds.maxZ - bounds.minZ;
      
      if (rangeX === 0 || rangeZ === 0) return;

      const scaleX = drawWidth / rangeX;
      const scaleZ = drawHeight / rangeZ;
      const scale = Math.min(scaleX, scaleZ);

      // Center the map
      const offsetX = (drawWidth - rangeX * scale) / 2 + padding;
      const offsetY = (drawHeight - rangeZ * scale) / 2 + padding;

      // Project local coordinates to canvas coordinates
      const project = (xLocal: number, zLocal: number) => {
        // X maps to Canvas X
        const x = (xLocal - bounds.minX) * scale + offsetX;
        
        // Z maps to Canvas Y. 
        const y = (zLocal - bounds.minZ) * scale + offsetY;
        
        return { x, y };
      };

      // Draw Track
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

      // Start/Finish Line
      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw Ghost Marker
      if (ghostPosition) {
        const { x, y } = project(ghostPosition[0], ghostPosition[2]);
        
        ctx.beginPath();
        ctx.fillStyle = '#fbbf24'; // amber-400 (Gold)
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw Car Marker
      const carIndex = currentIndex * 3;
      if (carIndex < positions.length) {
        const cx = positions[carIndex];
        const cz = positions[carIndex + 2];
        
        const { x, y } = project(cx, cz);
        
        ctx.beginPath();
        ctx.fillStyle = '#ef4444'; // red-500
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.strokeStyle = '#ffffff';
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

  }, [bounds, positions, currentIndex, ghostPosition]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full block"
    />
  );
};
