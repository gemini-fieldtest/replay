import React, { useRef, useEffect, useMemo } from 'react';

interface TrackMapProps {
  positions: Float32Array;
  currentIndex: number;
  ghostPosition?: [number, number, number] | null;
  carPosition?: [number, number, number] | null;
  staticMapPositions?: Float32Array | null;
  sectorMarkers?: any[]; // Keep as any[] for now to match error log implication, or refine type? The code uses {x, z, id}.
  rotation?: number;
}

export const TrackMap: React.FC<TrackMapProps> = ({ positions, currentIndex, ghostPosition, carPosition, staticMapPositions, sectorMarkers, rotation = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate bounds from positions (X and Z) - Include Static Map in bounds!
  const bounds = useMemo(() => {
    if (positions.length === 0 && (!staticMapPositions || staticMapPositions.length === 0)) return null;
    
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const process = (arr: Float32Array) => {
        for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i];
            const z = arr[i + 2];
            
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
    };

    if (positions.length > 0) process(positions);
    if (staticMapPositions && staticMapPositions.length > 0) process(staticMapPositions);

    if (minX === Infinity) return null;

    return { minX, maxX, minZ, maxZ };
  }, [positions, staticMapPositions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;

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

      // Calculate scale - accounting for rotation
      // If rotated 90 or 270 degrees, swap width/height matching
      const isRotated90 = Math.abs(Math.sin(rotation)) > 0.5;
      
      const fitWidth = isRotated90 ? drawHeight : drawWidth;
      const fitHeight = isRotated90 ? drawWidth : drawHeight;

      const scaleX = fitWidth / rangeX;
      const scaleZ = fitHeight / rangeZ;
      const scale = Math.min(scaleX, scaleZ);

      // Center the map
      const centerLocalX = (bounds.minX + bounds.maxX) / 2;
      const centerLocalZ = (bounds.minZ + bounds.maxZ) / 2;
      
      // We will translate to center of canvas, rotate, then scale/translate from map center
      const centerX = width / 2;
      const centerY = height / 2;

      // Project local coordinates to canvas coordinates (relative to map center)
      const project = (xLocal: number, zLocal: number) => {
        const dx = (xLocal - centerLocalX) * scale;
        const dy = (zLocal - centerLocalZ) * scale;
        return { x: dx, y: dy };
      };
      
      // Apply transforms
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation);

      // Draw Static Track (if available)
      if (staticMapPositions && staticMapPositions.length > 0) {
          ctx.beginPath();
          ctx.strokeStyle = '#22c55e'; // green-500
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.3; // Faint

          const startStatic = project(staticMapPositions[0], staticMapPositions[2]);
          ctx.moveTo(startStatic.x, startStatic.y);

          for (let i = 3; i < staticMapPositions.length; i += 3) {
            const { x, y } = project(staticMapPositions[i], staticMapPositions[i + 2]);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1.0; // Reset
      }
      
      // Draw Sectors
      if (sectorMarkers && sectorMarkers.length > 0) {
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = '#9ca3af'; // gray-400
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          sectorMarkers.forEach(sector => {
              const { x, y } = project(sector.x, sector.z);
              
              // Draw Marker Dot
              ctx.beginPath();
              ctx.fillStyle = '#6b7280'; // gray-500
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.fill();

              // Draw Label offset
              ctx.fillStyle = '#9ca3af'; // gray-400
              ctx.fillText(sector.id, x + 10, y - 10);
          });
      }

      // Draw Main Track (Live Trail)
      if (positions.length > 0) {
        ctx.beginPath();
        // If static map exists, make live trail distinct (e.g. Blue or White?) 
        // Or keep it Blue as before
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

        // Start/Finish Line (of live track? or static?) 
        // Usually Start/Finish is static.
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

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

  }, [bounds, positions, currentIndex, ghostPosition, carPosition, staticMapPositions, sectorMarkers, rotation]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full block"
    />
  );
};
