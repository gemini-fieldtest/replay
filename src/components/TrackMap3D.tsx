import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Video, Globe, ZoomIn } from 'lucide-react';

// ... (Imports and other components)
import type { TelemetryFrame } from '../utils/telemetryParser';

interface TrackProps {
  positions: Float32Array;
  color?: string;
  opacity?: number;
  transparent?: boolean;
}

const Track: React.FC<TrackProps> = React.memo(({ positions, color = "#00ff00", opacity = 1, transparent = false }) => {
  const points = useMemo(() => {
    if (positions.length === 0) return [];
    const pts = [];
    for (let i = 0; i < positions.length; i += 3) {
      pts.push(new THREE.Vector3(positions[i], positions[i+1], positions[i+2]));
    }
    return pts;
  }, [positions]);

  if (points.length === 0) return null;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={2}
      opacity={opacity}
      transparent={transparent}
    />
  );
});

interface PathSegmentProps {
  positions: Float32Array;
  startIndex: number;
  endIndex: number;
  color: string;
  lineWidth?: number;
  fade?: 'in' | 'out'; // 'in' = start transparent -> end solid, 'out' = start solid -> end transparent
}

const PathSegment: React.FC<PathSegmentProps> = ({ positions, startIndex, endIndex, color, lineWidth = 3, fade }) => {
  const { points, vertexColors } = useMemo(() => {
    if (positions.length === 0 || startIndex >= endIndex) return { points: [], vertexColors: [] };
    
    const pts: THREE.Vector3[] = [];
    const colors: [number, number, number][] = [];
    const baseColor = new THREE.Color(color);
    
    // Clamp indices
    const start = Math.max(0, startIndex);
    const end = Math.min(positions.length / 3, endIndex);
    const length = end - start;
    
    for (let i = start; i < end; i++) {
      // Lift Y slightly to avoid z-fighting with base track
      pts.push(new THREE.Vector3(positions[i*3], positions[i*3+1] + 0.5, positions[i*3+2]));
      
      if (fade) {
        // Calculate opacity based on position in segment
        const progress = (i - start) / length;
        const opacity = fade === 'in' ? progress : 1 - progress;
        
        const c = baseColor.clone().multiplyScalar(opacity); // Fade to black
        colors.push([c.r, c.g, c.b]);
      } else {
        colors.push([baseColor.r, baseColor.g, baseColor.b]);
      }
    }
    return { points: pts, vertexColors: colors };
  }, [positions, startIndex, endIndex, color, fade]);

  if (points.length === 0) return null;

  return (
    <Line
      points={points}
      color={fade ? undefined : color} // If using vertex colors, don't set base color
      vertexColors={fade ? vertexColors : undefined}
      lineWidth={lineWidth}
      toneMapped={false}
    />
  );
};

interface CarProps {
  position: [number, number, number];
  rotation: THREE.Euler;
  telemetry?: TelemetryFrame | null;
}

const Car: React.FC<CarProps> = ({ position, rotation, telemetry }) => {
  return (
    <group position={position} rotation={rotation}>
      {/* Car Body */}
      <mesh>
        <boxGeometry args={[2.5, 1.5, 5]} />
        <meshStandardMaterial color="#3b82f6" metalness={0.6} roughness={0.2} />
      </mesh>
      
      {/* Windshield */}
      <mesh position={[0, 0.5, 1]}>
        <boxGeometry args={[2.1, 0.8, 1.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Headlights */}
      <mesh position={[0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} />
      </mesh>
      <mesh position={[-0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} />
      </mesh>
      
      {/* Taillights */}
      <mesh position={[0, 0, -2.5]}>
        <boxGeometry args={[2.2, 0.3, 0.1]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1} />
      </mesh>

      {/* Dynamics Cage - Large wireframe box to visualize tilt/roll */}
      <mesh>
        <boxGeometry args={[12, 6, 16]} />
        <meshBasicMaterial color="white" wireframe opacity={0.1} transparent />
      </mesh>

      {/* G-Force Vector Arrow */}
      {telemetry && (
        <group>
          {/* Simple Arrows for now */}
          {/* Longitudinal (Accel/Brake) */}
          {Math.abs(telemetry.gForceLong) > 0.1 && (
             <arrowHelper 
               args={[
                 new THREE.Vector3(0, 0, telemetry.gForceLong > 0 ? -1 : 1), // Dir: -Z is forward
                 new THREE.Vector3(0, 2, 0), // Origin: Above car
                 Math.min(Math.abs(telemetry.gForceLong) * 5, 10), // Length
                 telemetry.gForceLong > 0 ? 0x00ff00 : 0xff0000, // Color: Green (Accel), Red (Brake)
                 1, // Head length
                 0.5 // Head width
               ]} 
             />
          )}

           {/* Lateral (Turning) */}
           {Math.abs(telemetry.gForceLat) > 0.1 && (
             <arrowHelper 
               args={[
                 new THREE.Vector3(telemetry.gForceLat > 0 ? -1 : 1, 0, 0), // Dir: -X is Right? +X is Right?
                 new THREE.Vector3(0, 2, 0), 
                 Math.min(Math.abs(telemetry.gForceLat) * 5, 10), 
                 0xffff00, // Yellow for turning
                 1, 
                 0.5
               ]} 
             />
          )}
        </group>
      )}
    </group>
  );
};

interface SceneContentProps {
  positions: Float32Array;
  currentIndex: number;
  followMode: boolean;
  currentFrame: TelemetryFrame | null;
  zoomLevel: number;
}

const SceneContent: React.FC<SceneContentProps> = ({ positions, currentIndex, followMode, currentFrame, zoomLevel }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null); // OrbitControls type is tricky to import directly from drei without issues, keeping any for now but acknowledging it.
  
  const targetLookAt = useRef(new THREE.Vector3());

  // Initial camera position
  useEffect(() => {
    if (!followMode) {
      camera.position.set(0, 500, 500);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, followMode]);

  // Get current car position from the flat array
  const currentPosVector = useMemo(() => {
    if (currentIndex * 3 + 2 >= positions.length) return new THREE.Vector3(0, 0, 0);
    return new THREE.Vector3(
      positions[currentIndex * 3],
      positions[currentIndex * 3 + 1],
      positions[currentIndex * 3 + 2]
    );
  }, [positions, currentIndex]);

  // Calculate Car Rotation
  const carRotation = useMemo(() => {
    if (!currentFrame || positions.length === 0) return new THREE.Euler(0, 0, 0);

    // 1. Calculate Yaw (Heading) from track geometry
    // Look at next point to determine heading
    let heading = 0;
    if (currentIndex * 3 + 5 < positions.length) {
      const nextX = positions[(currentIndex + 1) * 3];
      const nextZ = positions[(currentIndex + 1) * 3 + 2];
      const dx = nextX - currentPosVector.x;
      const dz = nextZ - currentPosVector.z;
      heading = Math.atan2(dx, dz); // Standard 3D heading (Y-rotation)
    } else if (currentIndex > 0) {
      // End of track, look back
      const prevX = positions[(currentIndex - 1) * 3];
      const prevZ = positions[(currentIndex - 1) * 3 + 2];
      const dx = currentPosVector.x - prevX;
      const dz = currentPosVector.z - prevZ;
      heading = Math.atan2(dx, dz);
    }

    // 2. Calculate Pitch (Slope + Dynamics)
    // Base pitch from slope can be derived from Y difference
    let slopePitch = 0;
    if (currentIndex * 3 + 5 < positions.length) {
       const nextY = positions[(currentIndex + 1) * 3 + 1];
       const nextX = positions[(currentIndex + 1) * 3];
       const nextZ = positions[(currentIndex + 1) * 3 + 2];
       const dy = nextY - currentPosVector.y;
       const dist = Math.sqrt(Math.pow(nextX - currentPosVector.x, 2) + Math.pow(nextZ - currentPosVector.z, 2));
       if (dist > 0.01) slopePitch = -Math.atan2(dy, dist);
    }

    // Dynamic Pitch from Longitudinal G (Accel/Brake)
    // Accel (Positive G) -> Pitch Up (Negative rotation X)
    // Brake (Negative G) -> Pitch Down (Positive rotation X)
    // Scale factor needs tuning. Let's say 1G = 5 degrees (0.08 rad)
    const dynamicPitch = (currentFrame.gForceLong || 0) * 0.08;

    // 3. Calculate Roll (Dynamics)
    // Turning Right (Positive Lat G) -> Roll Left (Positive rotation Z? No, usually roll out)
    // Actually, Lat G pushes car OUT. So turning right -> Lat G is Left (Negative)?
    // Standard convention: Lat G is positive when turning right?
    // Let's assume Lat G is positive when turning right. Car rolls LEFT (Z rotation positive).
    // Scale factor: 1G = 5 degrees
    const dynamicRoll = (currentFrame.gForceLat || 0) * 0.15; // Exaggerate roll a bit

    return new THREE.Euler(slopePitch + dynamicPitch, heading, dynamicRoll);
  }, [currentFrame, currentPosVector, currentIndex, positions]);


  useFrame((_, delta) => {
    if (!followMode) {
       if (controlsRef.current) controlsRef.current.update();
       return;
    }

    const carPos = currentPosVector;
    
    // Calculate direction vector based on car rotation (Yaw)
    const direction = new THREE.Vector3(Math.sin(carRotation.y), 0, Math.cos(carRotation.y));
    
    // Camera Offsets based on Zoom Level
    // 0: Far (Chase)
    // 1: Mid (Chase)
    // 2: Close (Chase)
    // 3: Bumper (First Person)
    let distance = 100;
    let height = 40;
    let lookAhead = 50;

    switch (zoomLevel) {
      case 0: // Far
        distance = 100;
        height = 40;
        lookAhead = 50;
        break;
      case 1: // Close
        distance = 30;
        height = 12;
        lookAhead = 30;
        break;
      case 2: // Bumper
        distance = -2; // In front of car center
        height = 2;
        lookAhead = 100; // Look further ahead
        break;
    }
    
    // Smoothly interpolate camera position
    const idealOffset = direction.clone().multiplyScalar(-distance).add(new THREE.Vector3(0, height, 0));
    const idealPos = carPos.clone().add(idealOffset);
    
    // Smooth look at point (slightly ahead of car)
    const idealLookAt = carPos.clone().add(direction.clone().multiplyScalar(lookAhead));

    // Lerp current camera position to ideal position
    // Use a factor relative to delta for frame-rate independence
    // Bumper cam needs to be snappier
    const damp = zoomLevel === 2 ? 15 * delta : 5 * delta;
    
    camera.position.lerp(idealPos, damp);
    
    // For lookAt, we can't easily lerp the "look at target" directly on the camera object
    // But we can maintain a target vector and lerp that
    targetLookAt.current.lerp(idealLookAt, damp);
    camera.lookAt(targetLookAt.current);

  });


  return (
    <>
      <OrbitControls ref={controlsRef} enableDamping enabled={!followMode} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1} />
      
      {/* Base Track - Green (Original) */}
      <Track positions={positions} color="#00ff00" opacity={0.3} transparent />
      
      {/* Past Trail - Orange (Where we have been) */}
      <PathSegment 
        positions={positions} 
        startIndex={currentIndex - 50} 
        endIndex={currentIndex + 1} 
        color="#ffaa00" 
        lineWidth={4}
        fade="in"
      />

      {/* Future Path - Cyan (Where we are going) */}
      <PathSegment 
        positions={positions} 
        startIndex={currentIndex} 
        endIndex={currentIndex + 100} 
        color="#00ffff" 
        lineWidth={4}
        fade="out"
      />
      
      <Car position={[currentPosVector.x, currentPosVector.y, currentPosVector.z]} rotation={carRotation} telemetry={currentFrame} />

      {/* Ground Plane */}
      <gridHelper args={[2000, 50, 0x444444, 0x222222]} position={[0, -50, 0]} />
    </>
  );
};

interface TrackMap3DProps {
  positions: Float32Array;
  currentIndex: number;
  currentFrame?: TelemetryFrame | null;
}

export const TrackMap3D: React.FC<TrackMap3DProps> = ({ positions, currentIndex, currentFrame = null }) => {
  const [followMode, setFollowMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // Default to Mid

  const cycleZoom = () => {
    setZoomLevel((prev) => (prev + 1) % 3);
  };

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden border border-gray-800 relative group">
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 200, 200]} fov={60} />
        <SceneContent positions={positions} currentIndex={currentIndex} followMode={followMode} currentFrame={currentFrame} zoomLevel={zoomLevel} />
      </Canvas>
      
      <div className="absolute top-4 left-4 z-10 flex bg-gray-900/90 backdrop-blur-sm rounded-lg p-1 border border-gray-700 gap-1">
        <button
          onClick={() => setFollowMode(false)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${
            !followMode 
              ? 'bg-blue-600 text-white shadow-sm' 
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <Globe size={14} />
          Orbit
        </button>
        <button
          onClick={() => setFollowMode(true)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${
            followMode 
              ? 'bg-blue-600 text-white shadow-sm' 
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <Video size={14} />
          Follow
        </button>
        
        {followMode && (
          <>
            <div className="w-px bg-gray-700 mx-1" />
            <button
              onClick={cycleZoom}
              className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors text-gray-400 hover:text-white hover:bg-gray-800"
              title="Cycle Zoom Level"
            >
              <ZoomIn size={14} />
              Zoom: {['Far', 'Close', 'Bumper'][zoomLevel]}
            </button>
          </>
        )}
      </div>

      {/* ... (Rest of component) */}

      <div className="absolute bottom-4 right-4 text-xs text-gray-500 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        {followMode ? 'Camera follows car' : 'Left Click: Rotate | Right Click: Pan | Scroll: Zoom'}
      </div>

      {/* Fixed HUD Overlay */}
      {currentFrame && (
        <div className="absolute top-4 right-4 z-10 bg-black/80 backdrop-blur-md p-3 rounded-lg border border-gray-700 text-xs font-mono text-white flex flex-col gap-2 shadow-xl min-w-[140px]">
          <div className="flex justify-between items-center border-b border-gray-700 pb-1 mb-1">
            <span className="text-gray-400 font-semibold">TELEMETRY</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Speed</span>
            <span className="font-bold text-blue-400 text-lg">{currentFrame.speed.toFixed(0)} <span className="text-xs text-gray-500">km/h</span></span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">G-Lat</span>
            <span className={`font-bold ${Math.abs(currentFrame.gForceLat) > 0.5 ? 'text-red-400' : 'text-white'}`}>
              {currentFrame.gForceLat.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">G-Long</span>
            <span className={`font-bold ${Math.abs(currentFrame.gForceLong) > 0.5 ? 'text-yellow-400' : 'text-white'}`}>
              {currentFrame.gForceLong.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Slope</span>
            <span className="font-bold text-green-400">{currentFrame.gradient.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
};
