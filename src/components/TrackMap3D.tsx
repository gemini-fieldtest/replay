import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Video, Globe, ZoomIn, Ghost } from 'lucide-react';

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
  opacity?: number;
  transparent?: boolean;
  color?: string;
}

const Car: React.FC<CarProps> = ({ position, rotation, telemetry, opacity = 1, transparent = false, color = "#3b82f6" }) => {
  return (
    <group position={position} rotation={rotation}>
      {/* Car Body */}
      <mesh>
        <boxGeometry args={[2.5, 1.5, 5]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.2} transparent={transparent} opacity={opacity} />
      </mesh>
      {/* Wireframe Overlay for better visibility when transparent */}
      {transparent && (
        <mesh>
            <boxGeometry args={[2.52, 1.52, 5.02]} />
            <meshBasicMaterial color="white" wireframe opacity={0.3} transparent />
        </mesh>
      )}
      
      {/* Windshield */}
      <mesh position={[0, 0.5, 1]}>
        <boxGeometry args={[2.1, 0.8, 1.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.1} transparent={transparent} opacity={opacity} />
      </mesh>
      
      {/* Headlights */}
      <mesh position={[0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh position={[-0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} transparent={transparent} opacity={opacity} />
      </mesh>
      
      {/* Taillights */}
      <mesh position={[0, 0, -2.5]}>
        <boxGeometry args={[2.2, 0.3, 0.1]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1} transparent={transparent} opacity={opacity} />
      </mesh>

      {/* Dynamics Cage - Large wireframe box to visualize tilt/roll */}
      <mesh>
        <boxGeometry args={[12, 6, 16]} />
        <meshBasicMaterial color="white" wireframe opacity={0.05} transparent />
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

interface GhostCarProps {
  position: [number, number, number];
  rotation: THREE.Euler;
}

const GhostCar: React.FC<GhostCarProps> = ({ position, rotation }) => {
  // Reuse Car component but with specific props for "Ideal Lap" look (Solid, Gold)
  return (
      <Car position={position} rotation={rotation} color="#fbbf24" />
  );
};

interface SceneContentProps {
  positions: Float32Array;
  currentIndex: number;
  followMode: boolean;
  currentFrame: TelemetryFrame | null;
  ghostPosition: [number, number, number] | null;
  showGhost: boolean;
  zoomLevel: number;
}

const SceneContent: React.FC<SceneContentProps> = ({ positions, currentIndex, followMode, currentFrame, ghostPosition, showGhost, zoomLevel }) => {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  
  const targetLookAt = useRef(new THREE.Vector3());

  // Initial camera position
  useEffect(() => {
    if (!followMode) {
      camera.position.set(0, 500, 500);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, followMode]);

  // Calculate car position
  const currentPosVector = useMemo(() => {
     if (positions.length === 0) return new THREE.Vector3(0,0,0);
     const idx = Math.min(currentIndex, (positions.length / 3) - 1);
     return new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
  }, [positions, currentIndex]);

  // Calculate Car Rotation
  const getCarRotation = useCallback((frame: TelemetryFrame | null, pos: THREE.Vector3, idx: number) => {
      if (!frame) return new THREE.Euler(0, 0, 0);
      
      // 1. Calculate Yaw (Heading) from track geometry
      let heading = 0;
      if (idx < (positions.length / 3) - 1) {
          const nextX = positions[(idx + 1) * 3];
          const nextZ = positions[(idx + 1) * 3 + 2];
          const dx = nextX - pos.x;
          const dz = nextZ - pos.z;
          heading = Math.atan2(dx, dz);
      } else if (idx > 0) { // If at the end, use previous point
          const prevX = positions[(idx - 1) * 3];
          const prevZ = positions[(idx - 1) * 3 + 2];
          const dx = pos.x - prevX;
          const dz = pos.z - prevZ;
          heading = Math.atan2(dx, dz);
      }

      // 2. Pitch & Roll (same as before)
      let slopePitch = 0;
      if (idx < (positions.length / 3) - 1) {
         const nextY = positions[(idx + 1) * 3 + 1];
         const nextX = positions[(idx + 1) * 3];
         const nextZ = positions[(idx + 1) * 3 + 2];
         const dy = nextY - pos.y;
         const dist = Math.sqrt(Math.pow(nextX - pos.x, 2) + Math.pow(nextZ - pos.z, 2));
         if (dist > 0.01) slopePitch = -Math.atan2(dy, dist);
      }

      const dynamicPitch = (frame.gForceLong || 0) * 0.08;
      const dynamicRoll = (frame.gForceLat || 0) * 0.15;

      return new THREE.Euler(slopePitch + dynamicPitch, heading, dynamicRoll);
  }, [positions]);

  const carRotation = useMemo(() => {
      return getCarRotation(currentFrame, currentPosVector, currentIndex);
  }, [currentFrame, currentPosVector, currentIndex, getCarRotation]);


  useFrame((_, delta) => {
    if (!followMode) {
       if (controlsRef.current) {
           // Keep target focused on the car even in orbit mode
           controlsRef.current.target.lerp(currentPosVector, 0.5);
           controlsRef.current.update();
       }
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
      
      {/* Main Car - Now Transparent/Ghost-like */}
      <Car 
        position={[currentPosVector.x, currentPosVector.y, currentPosVector.z]} 
        rotation={carRotation} 
        telemetry={currentFrame} 
        transparent 
        opacity={0.5} 
        color="#3b82f6"
      />

      {/* Ghost Car - Now Solid (Ideal Lap) */}
      {showGhost && ghostPosition && (
        <GhostCar position={ghostPosition} rotation={carRotation} />
      )}

      {/* Ground Plane */}
      <gridHelper args={[2000, 50, 0x444444, 0x222222]} position={[0, -50, 0]} />
    </>
  );
};

interface StartLineProps {
  position: [number, number, number];
}

const StartLine: React.FC<StartLineProps> = ({ position }) => {
  return (
    <group position={position}>
      {/* Checkered Line */}
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[1, 5, 20]} /> {/* Wide line across track */}
        <meshBasicMaterial color="white" opacity={0.5} transparent />
      </mesh>
      {/* Poles */}
      <mesh position={[0, 5, 10]}>
        <cylinderGeometry args={[0.5, 0.5, 10]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      <mesh position={[0, 5, -10]}>
        <cylinderGeometry args={[0.5, 0.5, 10]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {/* Banner */}
      <mesh position={[0, 10, 0]}>
        <boxGeometry args={[1, 2, 22]} />
        <meshStandardMaterial color="#cc0000" />
      </mesh>
    </group>
  );
};

interface TrackMap3DProps {
  positions: Float32Array;
  currentIndex: number;
  currentFrame?: TelemetryFrame | null;
  ghostFrame?: TelemetryFrame | null;
  ghostPosition?: [number, number, number] | null;
  showGhost: boolean;
  setShowGhost: (show: boolean) => void;
  startLinePos?: [number, number, number] | null;
}

export const TrackMap3D: React.FC<TrackMap3DProps> = ({ positions, currentIndex, currentFrame = null, ghostPosition = null, showGhost, setShowGhost, startLinePos }) => {
  const [followMode, setFollowMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // Default to Mid

  const cycleZoom = () => {
    setZoomLevel((prev) => (prev + 1) % 3);
  };

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden border border-gray-800 relative group">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[0, 50, 0]} fov={50} />
        <SceneContent 
            positions={positions} 
            currentIndex={currentIndex} 
            followMode={followMode} 
            currentFrame={currentFrame} 
            ghostPosition={ghostPosition}
            showGhost={showGhost}
            zoomLevel={zoomLevel} 
        />
        {showGhost && ghostPosition && (
            <GhostCar position={ghostPosition} rotation={new THREE.Euler(0,0,0)} /> 
        )}
        {startLinePos && <StartLine position={startLinePos} />}
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
        
        <div className="w-px bg-gray-700 mx-1" />
        <button
            onClick={() => setShowGhost(!showGhost)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${
                showGhost ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
            title="Toggle Ideal Lap Ghost"
        >
            <Ghost size={14} />
            Ghost
        </button>
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
