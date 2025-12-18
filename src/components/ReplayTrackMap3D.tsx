import React, { useMemo, useRef, useEffect, useState, memo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Video, Globe, ZoomIn } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { Line2 } from 'three-stdlib';

// ... (Imports and other components)
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';

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

// Imperative Path Segment
interface ImperativePathSegmentProps {
  positions: Float32Array;
  currentIndexRef: React.MutableRefObject<number>;
  startIndexOffset: number;
  endIndexOffset: number;
  color: string;
  lineWidth?: number;
  fade?: 'in' | 'out';
}

const ImperativePathSegment: React.FC<ImperativePathSegmentProps> = ({ positions, currentIndexRef, startIndexOffset, endIndexOffset, color, lineWidth = 3, fade }) => {
  const lineRef = useRef<Line2>(null);

  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  // Create initial points (just placeholders, size matters?)
  // Line2 buffers can be resized but it's expensive.
  // Best to allocate max size.
  // The segment length is usually fixed (e.g. 50 or 100 points).

  const maxPoints = Math.abs(endIndexOffset - startIndexOffset) + 1;

  const initialPoints = useMemo(() => {
      const pts: [number, number, number][] = [];
      for(let i=0; i<maxPoints; i++) pts.push([0, -1000, 0]); // Hide initially
      return pts;
  }, [maxPoints]);

  const initialColors = useMemo(() => {
      // Pre-calculate fade colors if possible?
      // Fade depends on relative index (0 to maxPoints).
      // So colors are actually static if the window slides!
      // YES! The colors relative to the *window* are constant.
      // We only update positions.

      const colors: [number, number, number][] = [];
      for(let i=0; i<maxPoints; i++) {
         if (fade) {
            const progress = i / (maxPoints - 1 || 1);
            const opacity = fade === 'in' ? progress : 1 - progress;
            const c = baseColor.clone().multiplyScalar(opacity);
            colors.push([c.r, c.g, c.b]);
         } else {
            colors.push([baseColor.r, baseColor.g, baseColor.b]);
         }
      }
      return colors;
  }, [maxPoints, fade, baseColor]);

  useFrame(() => {
     if (!lineRef.current) return;
     const line = lineRef.current;
     const currentIndex = currentIndexRef.current;

     // Calculate indices
     let start = currentIndex + startIndexOffset;
     let end = currentIndex + endIndexOffset;

     // Handle cases where start > end (shouldn't happen with offsets like -50, +1)
     if (startIndexOffset > endIndexOffset) {
         const t = start; start = end; end = t;
     }

     // Clamp
     const maxIdx = (positions.length / 3);
     const clampedStart = Math.max(0, Math.min(start, maxIdx));
     const clampedEnd = Math.max(0, Math.min(end, maxIdx));

     const count = clampedEnd - clampedStart;

     if (count <= 0) {
        // Hide
        line.visible = false;
        return;
     }
     line.visible = true;

     // We need to update positions.
     // Line2 uses `setPositions` which takes a flat array or array of points.
     // Accessing `positions` (Float32Array) directly is fast.
     // We need to extract the slice.

     // Optimization: Can we pass the subarray directly?
     // positions is x,y,z...
     // We need to lift Y by 0.5. So we can't just copy.

     const segmentPoints: number[] = [];
     // We need exactly `maxPoints` to match the colors buffer if we want to avoid re-allocating colors?
     // Or `Line2` handles mismatch? `Line2` geometry has `setPositions`.
     // If we change number of points, we might need to update colors too?
     // Colors buffer usually must match vertex count.

     // If the actual segment is shorter than maxPoints (at start/end of track),
     // we should pad with the last point or hide?
     // Padding is easier.

     for (let i = 0; i < maxPoints; i++) {
         let idx = start + i;
         if (idx < 0) idx = 0;
         if (idx >= maxIdx) idx = maxIdx - 1;

         // If "start" was negative, we might be padding the beginning.
         // Effectively we are sliding the window.

         segmentPoints.push(positions[idx*3], positions[idx*3+1] + 0.5, positions[idx*3+2]);
     }

     line.geometry.setPositions(segmentPoints);

     // Colors are already set and don't need update if they are relative to window position!
  });

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      vertexColors={initialColors}
      color={undefined} // use vertex colors
      lineWidth={lineWidth}
      toneMapped={false}
      frustumCulled={false} // Prevent flickering when updating geometry
    />
  );
};


interface ImperativeCarProps {
  // We need data to calculate rotation/position
  positions: Float32Array; // Track geometry
  data: TelemetryFrame[]; // Telemetry frames for G-force
  currentIndexRef: React.MutableRefObject<number>;
  color?: string;
  transparent?: boolean;
  opacity?: number;
}

const ImperativeCar: React.FC<ImperativeCarProps> = ({ positions, data, currentIndexRef, color="#3b82f6", transparent=false, opacity=1 }) => {
    const groupRef = useRef<THREE.Group>(null);
    const arrowLongRef = useRef<THREE.ArrowHelper>(null);
    const arrowLatRef = useRef<THREE.ArrowHelper>(null);

    // Reuse helper vectors
    const vecPos = useMemo(() => new THREE.Vector3(), []);
    const eulerRot = useMemo(() => new THREE.Euler(), []);

    useFrame(() => {
        if (!groupRef.current) return;
        const idx = currentIndexRef.current;
        const maxIdx = (positions.length / 3) - 1;
        const safeIdx = Math.max(0, Math.min(idx, maxIdx));

        // Position
        vecPos.set(positions[safeIdx*3], positions[safeIdx*3+1], positions[safeIdx*3+2]);
        groupRef.current.position.copy(vecPos);

        // Rotation
        // 1. Heading
        let heading = 0;
        if (safeIdx < maxIdx) {
            const nextX = positions[(safeIdx+1)*3];
            const nextZ = positions[(safeIdx+1)*3+2];
            heading = Math.atan2(nextX - vecPos.x, nextZ - vecPos.z);
        } else if (safeIdx > 0) {
            const prevX = positions[(safeIdx-1)*3];
            const prevZ = positions[(safeIdx-1)*3+2];
            heading = Math.atan2(vecPos.x - prevX, vecPos.z - prevZ);
        }

        // 2. Slope
        let slopePitch = 0;
        if (safeIdx < maxIdx) {
             const nextY = positions[(safeIdx + 1) * 3 + 1];
             const nextX = positions[(safeIdx + 1) * 3];
             const nextZ = positions[(safeIdx + 1) * 3 + 2];
             const dy = nextY - vecPos.y;
             const dist = Math.sqrt(Math.pow(nextX - vecPos.x, 2) + Math.pow(nextZ - vecPos.z, 2));
             if (dist > 0.01) slopePitch = -Math.atan2(dy, dist);
        }

        // 3. Dynamic Tilt
        const frame = data[safeIdx];
        const dynamicPitch = (frame?.gForceLong || 0) * 0.08;
        const dynamicRoll = (frame?.gForceLat || 0) * 0.15;

        eulerRot.set(slopePitch + dynamicPitch, heading, dynamicRoll);
        groupRef.current.rotation.copy(eulerRot);

        // G-Force Arrows
        if (frame) {
            if (arrowLongRef.current) {
                const gLong = frame.gForceLong || 0;
                if (Math.abs(gLong) > 0.1) {
                    arrowLongRef.current.visible = true;
                    // Direction: -Z is forward. +G (Accel) -> Backward vector (Push back)?
                    // Usually G-force vector visualizes the FORCE felt.
                    // Accel (+Long) -> Felt Backwards.
                    // Brake (-Long) -> Felt Forwards.
                    // Original code: telemetry.gForceLong > 0 ? -1 : 1.
                    // If > 0 (Accel), direction -1 (Forward??). No, -Z is forward in ThreeJS usually?
                    // Let's stick to original logic:
                    // telemetry.gForceLong > 0 ? -1 : 1
                    const dirZ = gLong > 0 ? -1 : 1;
                    arrowLongRef.current.setDirection(new THREE.Vector3(0, 0, dirZ));
                    arrowLongRef.current.setLength(Math.min(Math.abs(gLong) * 5, 10), 1, 0.5);
                    // Color is not easily mutable on ArrowHelper without accessing .line and .cone
                    // But we can just assume colors are fixed or use two arrows?
                    // Or recreate? Recreating is bad.
                    // Let's just set color if we can.
                    const color = gLong > 0 ? 0x00ff00 : 0xff0000;
                    arrowLongRef.current.setColor(new THREE.Color(color));
                } else {
                    arrowLongRef.current.visible = false;
                }
            }

            if (arrowLatRef.current) {
                 const gLat = frame.gForceLat || 0;
                 if (Math.abs(gLat) > 0.1) {
                     arrowLatRef.current.visible = true;
                     const dirX = gLat > 0 ? -1 : 1;
                     arrowLatRef.current.setDirection(new THREE.Vector3(dirX, 0, 0));
                     arrowLatRef.current.setLength(Math.min(Math.abs(gLat) * 5, 10), 1, 0.5);
                 } else {
                     arrowLatRef.current.visible = false;
                 }
            }
        }
    });

  return (
    <group ref={groupRef}>
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

      {/* Dynamics Cage */}
      <mesh>
        <boxGeometry args={[12, 6, 16]} />
        <meshBasicMaterial color="white" wireframe opacity={0.05} transparent />
      </mesh>

      {/* G-Force Vectors */}
      <arrowHelper ref={arrowLongRef} args={[new THREE.Vector3(0,0,1), new THREE.Vector3(0,2,0), 0, 0xffff00]} />
      <arrowHelper ref={arrowLatRef} args={[new THREE.Vector3(1,0,0), new THREE.Vector3(0,2,0), 0, 0xffff00]} />
    </group>
  );
};


interface ImperativeGhostCarProps {
  ghostPositions: Float32Array;
  idealLap: LapData | null;
  laps: LapData[];
  data: TelemetryFrame[];
  currentIndexRef: React.MutableRefObject<number>;
}

const ImperativeGhostCar: React.FC<ImperativeGhostCarProps> = ({ ghostPositions, idealLap, laps, data, currentIndexRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current || !idealLap || !laps.length || ghostPositions.length === 0) {
      if (meshRef.current) meshRef.current.visible = false;
      return;
    }

    const currentIndex = currentIndexRef.current;
    if (currentIndex < 0 || currentIndex >= data.length) return;

    const currentFrame = data[currentIndex];
    const time = currentFrame.time;

    // Find current lap
    // Optimization: Store last known lap index in a ref to avoid scanning laps every frame?
    // For now simple find is ok as laps array is small.
    let currentLap = laps.find(l => time >= l.frames[0].time && time <= l.frames[l.frames.length - 1].time);

    // Fallback logic from useTelemetry
    if (!currentLap && laps.length > 0) {
        const lastLap = laps[laps.length - 1];
        if (time > lastLap.frames[lastLap.frames.length - 1].time) {
            currentLap = lastLap;
        } else if (time < laps[0].frames[0].time) {
            // Before first lap
            // Use start of ideal lap
            const idx = 0;
             if (idx < ghostPositions.length / 3) {
                 meshRef.current.position.set(ghostPositions[idx*3], ghostPositions[idx*3+1] + 0.5, ghostPositions[idx*3+2]);
                 meshRef.current.visible = true;
             }
             return;
        }
    }

    if (!currentLap) {
         meshRef.current.visible = false;
         return;
    }

    const relativeTime = time - currentLap.frames[0].time;

    // Binary search for closest frame in idealLap
    let low = 0;
    let high = idealLap.frames.length - 1;
    let bestIdx = 0;

    // Optimization: Store last index to start search from there?
    // Given the playback is sequential, it should be close.
    // But scrubbing breaks that assumption. Binary search is fast enough (log N for ~3000 points).

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (idealLap.frames[mid].time < relativeTime) {
            bestIdx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    // Update position
    // ghostPositions matches idealLap.frames indices
    if (bestIdx < ghostPositions.length / 3) {
        meshRef.current.position.set(ghostPositions[bestIdx*3], ghostPositions[bestIdx*3+1] + 0.5, ghostPositions[bestIdx*3+2]);
        meshRef.current.visible = true;
    } else {
        meshRef.current.visible = false;
    }
  });

  return (
    <mesh ref={meshRef}>
        <boxGeometry args={[2.5, 1.5, 5]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.6} roughness={0.2} />
    </mesh>
  );
}


interface SceneContentProps {
  positions: Float32Array;
  data: TelemetryFrame[];
  currentIndexRef: React.MutableRefObject<number>;
  followMode: boolean;
  showGhost: boolean;
  zoomLevel: number;

  // New props for imperative ghost
  ghostPositions: Float32Array;
  idealLap: LapData | null;
  laps: LapData[];

  // Backwards compatibility
  ghostPosition: [number, number, number] | null;
}

// Optimized Scene Content
const SceneContent: React.FC<SceneContentProps> = ({ positions, data, currentIndexRef, followMode, showGhost, zoomLevel, ghostPositions, idealLap, laps, ghostPosition }) => {
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

      {/* Imperative Ghost Car */}
      {showGhost && (
        <ImperativeGhostCar
            ghostPositions={ghostPositions}
            idealLap={idealLap}
            laps={laps}
            data={data}
            currentIndexRef={currentIndexRef}
        />
      )}

      {/* Fallback Ghost Position (if passed) - Only if not using imperative?
          Or overlay? For now, let's keep it if imperative is empty.
      */}
      {showGhost && ghostPosition && ghostPositions.length === 0 && (
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

interface ReplayTrackMap3DProps {
  positions: Float32Array;
  // We need the full data for ImperativeCar
  data?: TelemetryFrame[];

  // Ref based inputs
  currentIndexRef?: React.MutableRefObject<number>;

  // Backward compatibility (if needed) or for initial render
  currentIndex?: number;

  // Ghost Data
  ghostPositions?: Float32Array;
  idealLap?: LapData | null;
  laps?: LapData[];

  // Backwards compatibility
  ghostPosition?: [number, number, number] | null;

  showGhost: boolean;
  startLinePos?: [number, number, number] | null;
  // Previously we used currentFrame for HUD, but that's gone now.
  // We keep the prop type definition clean if other files used it, but we removed it.
  currentFrame?: TelemetryFrame | null;
}

export const ReplayTrackMap3D: React.FC<ReplayTrackMap3DProps> = memo(({
    positions,
    data = [],
    currentIndexRef,
    currentIndex = 0,
    ghostPositions = new Float32Array(0),
    idealLap = null,
    laps = [],
    ghostPosition = null,
    showGhost,
    startLinePos
}) => {
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
            showGhost={showGhost}
            zoomLevel={zoomLevel}
            ghostPositions={ghostPositions}
            idealLap={idealLap}
            laps={laps}
            ghostPosition={ghostPosition}
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
    </div>
  );
});
