import React, { useRef, useEffect, useState, memo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Video, Globe, ZoomIn } from 'lucide-react';
import { useTheme } from './ThemeProvider';

// Import Shared Primitives
import { Track, ImperativePathSegment, ImperativeCar, StartLine } from './Track3DPrimitives';
import type { TelemetryFrame } from '../utils/telemetryParser';

interface SceneContentProps {
  positions: Float32Array;
  data: TelemetryFrame[];
  currentIndexRef: React.MutableRefObject<number>;
  followMode: boolean;
  ghostPosition: [number, number, number] | null;
  showGhost: boolean;
  zoomLevel: number;
}

// Optimized Scene Content
const SceneContent: React.FC<SceneContentProps> = ({ positions, data, currentIndexRef, followMode, ghostPosition, showGhost, zoomLevel }) => {
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

  // Initial camera position
  useEffect(() => {
    if (!followMode) {
      camera.position.set(0, 500, 500);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, followMode]);

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

    // idealOffset = direction * -distance + (0, height, 0)
    vecIdealOff.current.copy(vecDir.current).multiplyScalar(-distance).add(new THREE.Vector3(0, height, 0));
    vecIdealPos.current.copy(vecCarPos.current).add(vecIdealOff.current);

    // idealLookAt = carPos + direction * lookAhead
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

      {/* Base Track */}
      <Track positions={positions} color="#00ff00" opacity={0.3} transparent />

      {/* Imperative Paths */}
      <ImperativePathSegment
        positions={positions}
        currentIndexRef={currentIndexRef}
        startIndexOffset={-50}
        endIndexOffset={1}
        color="#ffaa00"
        lineWidth={4}
        fade="in"
      />

      <ImperativePathSegment
        positions={positions}
        currentIndexRef={currentIndexRef}
        startIndexOffset={0}
        endIndexOffset={100}
        color="#00ffff"
        lineWidth={4}
        fade="out"
      />

      {/* Imperative Car */}
      <ImperativeCar
         positions={positions}
         data={data}
         currentIndexRef={currentIndexRef}
         transparent
         opacity={0.5}
         color="#3b82f6"
      />

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

interface ReplayTrackMap3DProps {
  positions: Float32Array;
  // We need the full data for ImperativeCar
  data?: TelemetryFrame[];

  // Ref based inputs
  currentIndexRef?: React.MutableRefObject<number>;

  // Backward compatibility (if needed) or for initial render
  currentIndex?: number;
  currentFrame?: TelemetryFrame | null;

  ghostPosition?: [number, number, number] | null;
  showGhost: boolean;
  startLinePos?: [number, number, number] | null;
}

export const ReplayTrackMap3D: React.FC<ReplayTrackMap3DProps> = memo(({ positions, data = [], currentIndexRef, currentIndex = 0, currentFrame = null, ghostPosition = null, showGhost, startLinePos }) => {
  const [followMode, setFollowMode] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1); // Default to Mid

  // Internal ref if not provided (fallback)
  const localIndexRef = useRef(currentIndex);

  // Sync local ref if prop changes (for fallback mode)
  useEffect(() => {
     localIndexRef.current = currentIndex;
  }, [currentIndex]);

  const effectiveRef = currentIndexRef || localIndexRef;

  const cycleZoom = () => {
    setZoomLevel((prev) => (prev + 1) % 3);
  };

  const { theme } = useTheme();

  return (
    <div className="w-full h-full bg-gray-100 dark:bg-black rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 relative group">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={[theme === 'light' ? '#f3f4f6' : '#000000']} />
        <PerspectiveCamera makeDefault position={[0, 50, 0]} fov={50} />

        <SceneContent
            positions={positions}
            data={data}
            currentIndexRef={effectiveRef}
            followMode={followMode}
            ghostPosition={ghostPosition}
            showGhost={showGhost}
            zoomLevel={zoomLevel}
        />

        {startLinePos && <StartLine position={startLinePos} />}
      </Canvas>

      <div className="absolute top-4 left-4 z-10 flex bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg p-1 border border-gray-200 dark:border-gray-700 gap-1 shadow-sm">
        <button
          onClick={() => setFollowMode(false)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors ${
            !followMode
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
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
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <Video size={14} />
          Follow
        </button>

        {followMode && (
          <>
            <div className="w-px bg-gray-300 dark:bg-gray-700 mx-1" />
            <button
              onClick={cycleZoom}
              className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Cycle Zoom Level"
            >
              <ZoomIn size={14} />
              Zoom: {['Far', 'Close', 'Bumper'][zoomLevel]}
            </button>
          </>
        )}
      </div>

      <div className="absolute bottom-4 right-4 text-xs text-gray-500 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        {followMode ? 'Camera follows car' : 'Left Click: Rotate | Right Click: Pan | Scroll: Zoom'}
      </div>

      {currentFrame && (
        <div className="absolute top-4 right-4 z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md p-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-900 dark:text-white flex flex-col gap-2 shadow-xl min-w-[140px]">
          <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-1 mb-1">
            <span className="text-gray-500 dark:text-gray-400 font-semibold">TELEMETRY</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Speed</span>
            <span className="font-bold text-blue-600 dark:text-blue-400 text-lg">{currentFrame.speed?.toFixed(0) ?? '0'} <span className="text-xs text-gray-500 dark:text-gray-500">km/h</span></span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">G-Lat</span>
            <span className={`font-bold ${Math.abs(currentFrame.gForceLat ?? 0) > 0.5 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
              {currentFrame.gForceLat?.toFixed(2) ?? '0.00'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">G-Long</span>
            <span className={`font-bold ${Math.abs(currentFrame.gForceLong ?? 0) > 0.5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'}`}>
              {currentFrame.gForceLong?.toFixed(2) ?? '0.00'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Slope</span>
            <span className="font-bold text-green-600 dark:text-green-400">{currentFrame.gradient?.toFixed(1) ?? '0.0'}%</span>
          </div>
        </div>
      )}
    </div>
  );
});
