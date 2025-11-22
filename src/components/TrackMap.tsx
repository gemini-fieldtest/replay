import React, { useRef, useEffect, useMemo } from 'react';

interface TrackMapProps {
  positions: Float32Array;
  currentIndex: number;
}

export const TrackMap: React.FC<TrackMapProps> = ({ positions, currentIndex }) => {
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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
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
      // In 3D, Z is forward/back. In 2D map, usually North is Up.
      // Our 3D Z calculation was: -(lat - center) * scale. 
      // So +Lat (North) = -Z.
      // Canvas Y increases Down.
      // So we want North (-Z) to be Up (0).
      // So we want to map minZ (North-most if negative?) 
      // Let's look at App.tsx: pos[i*3+2] = -(f.latitude - centerLat) * latScale;
      // +Lat = -Z.
      // So smaller Z is more North.
      // We want smaller Z to be smaller Y (Up).
      // So (zLocal - bounds.minZ) * scale + offsetY would map minZ to Top.
      // Let's try that.
      const y = (zLocal - bounds.minZ) * scale + offsetY;
      
      return { x, y };
    };

    // Draw Track
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6'; // blue-500
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i];
      const pz = positions[i + 2];
      const { x, y } = project(px, pz);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw Start/Finish
    const startX = positions[0];
    const startZ = positions[2];
    const start = project(startX, startZ);
    ctx.fillStyle = '#10b981'; // green-500
    ctx.beginPath();
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw Car
    if (currentIndex * 3 + 2 < positions.length) {
      const carX = positions[currentIndex * 3];
      const carZ = positions[currentIndex * 3 + 2];
      const { x, y } = project(carX, carZ);
      
      // Outer glow
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;
      
      ctx.beginPath();
      ctx.fillStyle = '#ef4444'; // red-500
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      
      // Inner dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [positions, currentIndex, bounds]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full bg-gray-900 rounded-lg"
      style={{ width: '100%', height: '100%' }}
    />
  );
};
