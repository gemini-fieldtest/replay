import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Video, Globe, ZoomIn, Ghost } from 'lucide-react';
import { Track, ImperativePathSegment, ImperativeCar } from './Track3DPrimitives';

import type { TelemetryFrame } from '../utils/telemetryParser';

// Reuse StartLine from ReplayTrackMap3D (should probably be shared too, but small enough)
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

interface SceneContentProps {
  positions: Float32Array;
  currentIndexRef: React.MutableRefObject<number>;
  followMode: boolean;
  currentFrame: TelemetryFrame | null;
  ghostPosition: [number, number, number] | null;
  showGhost: boolean;
  zoomLevel: number;
  staticMapPositions?: Float32Array | null;
  sectorMarkers?: { id: string; name: string; x: number; z: number }[];
  rotation?: number; // Radians
}

const SceneContent: React.FC<SceneContentProps> = ({ positions, currentIndexRef, followMode, currentFrame, ghostPosition, showGhost, zoomLevel, staticMapPositions, sectorMarkers = [], rotation = 0 }) => {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const targetLookAt = useRef(new THREE.Vector3());

  // Helper vectors for camera logic (avoid GC)
  const vecCarPos = useRef(new THREE.Vector3());
  const vecDir = useRef(new THREE.Vector3());
  const vecIdealOff = useRef(new THREE.Vector3());
  const vecIdealPos = useRef(new THREE.Vector3());
  const vecIdealLookAt = useRef(new THREE.Vector3());

  // Initial camera position - rotate around 0,0 based on rotation prop
  useEffect(() => {
    if (!followMode) {
      const radius = 1000;
      const height = 2000;
      const angle = rotation; 
      const x = radius * Math.sin(angle);
      const z = radius * Math.cos(angle);
      
      camera.position.set(x, height, z);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, followMode, rotation]);


  useFrame((_, delta) => {
    // Get current car position (imperatively)
    const idx = currentIndexRef.current;
    const maxIdx = (positions.length / 3) - 1;
    const safeIdx = Math.max(0, Math.min(idx, maxIdx));

    vecCarPos.current.set(positions[safeIdx*3], positions[safeIdx*3+1], positions[safeIdx*3+2]);

    if (!followMode) {
       if (controlsRef.current) {
           controlsRef.current.target.lerp(vecCarPos.current, 0.5);
           controlsRef.current.update();
       }
       return;
    }

    // Calculate Heading for Camera
    let heading = 0;
    if (safeIdx < maxIdx) {
        const nextX = positions[(safeIdx+1)*3];
        const nextZ = positions[(safeIdx+1)*3+2];
        heading = Math.atan2(nextX - vecCarPos.current.x, nextZ - vecCarPos.current.z);
    } else if (safeIdx > 0) {
        const prevX = positions[(safeIdx-1)*3];
        const prevZ = positions[(safeIdx-1)*3+2];
        heading = Math.atan2(vecCarPos.current.x - prevX, vecCarPos.current.z - prevZ);
    }

    vecDir.current.set(Math.sin(heading), 0, Math.cos(heading));

    // Camera Offsets
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
        distance = -2;
        height = 2;
        lookAhead = 100;
        break;
    }
    
    vecIdealOff.current.copy(vecDir.current).multiplyScalar(-distance).add(new THREE.Vector3(0, height, 0));
    vecIdealPos.current.copy(vecCarPos.current).add(vecIdealOff.current);
    vecIdealLookAt.current.copy(vecCarPos.current).add(vecDir.current.clone().multiplyScalar(lookAhead));

    const damp = zoomLevel === 2 ? 15 * delta : 5 * delta;
    
    camera.position.lerp(vecIdealPos.current, damp);
    targetLookAt.current.lerp(vecIdealLookAt.current, damp);
    camera.lookAt(targetLookAt.current);
  });


  return (
    <>
      <OrbitControls ref={controlsRef} enableDamping enabled={!followMode} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1} />
      
      {/* Static Map - White/Gray */}
      {staticMapPositions && (
        <Track 
          positions={staticMapPositions} 
          color="#888888" 
          opacity={1} 
          transparent 
        />
      )}
      {/* Sector Markers */}
      {sectorMarkers.map((sector) => (
          <group key={sector.id} position={[sector.x, 0, sector.z]}>
              {/* Vertical Pylon */}
              <mesh position={[0, 10, 0]}>
                  <cylinderGeometry args={[0.5, 0.5, 20]} />
                  <meshStandardMaterial color="#4b5563" transparent opacity={0.5} />
              </mesh>
              {/* Floating Label (Simple Box for now, or just a colored sphere) */}
              <mesh position={[0, 22, 0]}>
                  <sphereGeometry args={[2]} />
                  <meshStandardMaterial color="#6b7280" />
              </mesh>
          </group>
      ))}

      {/* Live Base Track - Hidden if static map exists, or maybe shown faintly? */}
      {!staticMapPositions && (
         <Track positions={positions} color="#00ff00" opacity={0.3} transparent />
      )}
      
      {/* Past Trail - Orange */}
      <ImperativePathSegment
        positions={positions} 
        currentIndexRef={currentIndexRef}
        startIndexOffset={-50}
        endIndexOffset={1}
        color="#ffaa00" 
        lineWidth={4}
        fade="in"
      />

      {/* Future Path - Cyan */}
      <ImperativePathSegment
        positions={positions} 
        currentIndexRef={currentIndexRef}
        startIndexOffset={0}
        endIndexOffset={100}
        color="#00ffff" 
        lineWidth={4}
        fade="out"
      />
      
      {/* Main Car - Now Transparent/Ghost-like */}
      <ImperativeCar
        positions={positions}
        currentIndexRef={currentIndexRef}
        currentFrame={currentFrame}
        transparent
        opacity={0.5}
        color="#3b82f6"
        showGForce={true}
      />

      {/* Ghost Car - Now Solid (Ideal Lap) */}
      {showGhost && ghostPosition && (
          <mesh position={ghostPosition}>
             <boxGeometry args={[2.5, 1.5, 5]} />
             <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.2} />
          </mesh>
      )}

      {/* Ground Plane */}
      <gridHelper args={[2000, 50, 0x444444, 0x222222]} position={[0, -50, 0]} />
    </>
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
  gpsOnly?: boolean;
  staticMapPositions?: Float32Array | null;
  sectorMarkers?: { id: string; name: string; x: number; z: number }[];
  rotation?: number;
}

export const TrackMap3D: React.FC<TrackMap3DProps> = ({ positions, currentIndex, currentFrame = null, ghostPosition = null, showGhost, setShowGhost, startLinePos, gpsOnly = false, staticMapPositions, sectorMarkers, rotation = 0 }) => {
  const [followMode, setFollowMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // Default to Mid

  // Ref for imperative updates
  const currentIndexRef = useRef(currentIndex);

  // Update ref when prop changes
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const cycleZoom = () => {
    setZoomLevel((prev) => (prev + 1) % 3);
  };

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden border border-gray-800 relative group">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[0, 50, 0]} fov={50} far={10000} />
        <SceneContent 
            positions={positions} 
            currentIndexRef={currentIndexRef}
            followMode={followMode} 
            currentFrame={currentFrame} 
            ghostPosition={ghostPosition}
            showGhost={showGhost}
            zoomLevel={zoomLevel} 
            staticMapPositions={staticMapPositions}
            sectorMarkers={sectorMarkers}
            rotation={rotation}
        />
        {showGhost && ghostPosition && (
            <mesh position={ghostPosition}>
                <boxGeometry args={[2.5, 1.5, 5]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.2} />
            </mesh>
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
            <span className="font-bold text-blue-400 text-lg">{currentFrame.speed?.toFixed(0) ?? '0'} <span className="text-xs text-gray-500">km/h</span></span>
          </div>
          
          {!gpsOnly && (
            <>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">G-Lat</span>
                <span className={`font-bold ${Math.abs(currentFrame.gForceLat ?? 0) > 0.5 ? 'text-red-400' : 'text-white'}`}>
                  {currentFrame.gForceLat?.toFixed(2) ?? '0.00'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">G-Long</span>
                <span className={`font-bold ${Math.abs(currentFrame.gForceLong ?? 0) > 0.5 ? 'text-yellow-400' : 'text-white'}`}>
                  {currentFrame.gForceLong?.toFixed(2) ?? '0.00'}
                </span>
              </div>
            </>
          )}

          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Slope</span>
            <span className="font-bold text-green-400">{currentFrame.gradient?.toFixed(1) ?? '0.0'}%</span>
          </div>
        </div>
      )}
    </div>
  );
};
