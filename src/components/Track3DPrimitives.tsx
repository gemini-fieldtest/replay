import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { Line2 } from 'three-stdlib';
import type { TelemetryFrame } from '../utils/telemetryParser';

// --- Static Track Component ---
interface TrackProps {
  positions: Float32Array;
  color?: string;
  opacity?: number;
  transparent?: boolean;
}

export const StaticTrack: React.FC<TrackProps> = React.memo(({ positions, color = "#00ff00", opacity = 1, transparent = false }) => {
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

// --- Imperative Path Segment ---
interface ImperativePathSegmentProps {
  positions: Float32Array;
  currentIndexRef: React.MutableRefObject<number>;
  startIndexOffset: number;
  endIndexOffset: number;
  color: string;
  lineWidth?: number;
  fade?: 'in' | 'out';
}

export const ImperativePathSegment: React.FC<ImperativePathSegmentProps> = ({ positions, currentIndexRef, startIndexOffset, endIndexOffset, color, lineWidth = 3, fade }) => {
  const lineRef = useRef<Line2>(null);

  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const maxPoints = Math.abs(endIndexOffset - startIndexOffset) + 1;

  // Initial placeholders
  const initialPoints = useMemo(() => {
      const pts: [number, number, number][] = [];
      for(let i=0; i<maxPoints; i++) pts.push([0, -1000, 0]);
      return pts;
  }, [maxPoints]);

  const initialColors = useMemo(() => {
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

  // Buffer optimization: Pre-allocate a standard array (Line2 setPositions handles number[])
  // We avoid recreating this array every frame.
  const pointsBuffer = useRef<number[]>(new Array(maxPoints * 3));

  useFrame(() => {
     if (!lineRef.current) return;
     const line = lineRef.current;
     const currentIndex = currentIndexRef.current;

     let start = currentIndex + startIndexOffset;
     let end = currentIndex + endIndexOffset;

     if (startIndexOffset > endIndexOffset) {
         const t = start; start = end; end = t;
     }

     const maxIdx = (positions.length / 3);
     const clampedStart = Math.max(0, Math.min(start, maxIdx));
     const clampedEnd = Math.max(0, Math.min(end, maxIdx));

     const count = clampedEnd - clampedStart;

     if (count <= 0) {
        line.visible = false;
        return;
     }
     line.visible = true;

     const arr = pointsBuffer.current;
     let ptr = 0;

     for (let i = 0; i < maxPoints; i++) {
         let idx = start + i;
         if (idx < 0) idx = 0;
         if (idx >= maxIdx) idx = maxIdx - 1;

         arr[ptr++] = positions[idx*3];
         arr[ptr++] = positions[idx*3+1] + 0.5;
         arr[ptr++] = positions[idx*3+2];
     }

     line.geometry.setPositions(arr);
  });

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      vertexColors={initialColors}
      color={undefined}
      lineWidth={lineWidth}
      toneMapped={false}
      frustumCulled={false}
    />
  );
};


// --- Imperative Car ---
interface ImperativeCarProps {
  positions: Float32Array;
  rotations?: Float32Array; // Optional pre-calculated rotations [pitch, yaw, roll] (roll might be 0 here if dynamic)
  data?: TelemetryFrame[]; // Telemetry frames for G-force
  currentIndexRef: React.MutableRefObject<number>;
  color?: string;
  transparent?: boolean;
  opacity?: number;
}

export const ImperativeCar: React.FC<ImperativeCarProps> = ({ positions, rotations, data, currentIndexRef, color="#3b82f6", transparent=false, opacity=1 }) => {
    const groupRef = useRef<THREE.Group>(null);
    const arrowLongRef = useRef<THREE.ArrowHelper>(null);
    const arrowLatRef = useRef<THREE.ArrowHelper>(null);

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
        // Use pre-calculated rotations if available, otherwise calculate on the fly
        let slopePitch = 0;
        let heading = 0;

        if (rotations && safeIdx < (rotations.length / 2)) {
             // rotations stored as [pitch, yaw, pitch, yaw...] ? Or maybe just [heading, slope]?
             // Let's assume rotations is [pitch, yaw] per point.
             // slopePitch = rotations[safeIdx * 2];
             // heading = rotations[safeIdx * 2 + 1];

             // Wait, the plan was to implement this. Let's assume we will pass it.
             // But for now, let's keep the fallback.

             // If we implement the pre-calc, we'll likely store [pitch, yaw].
             // Checking length to be safe.

             slopePitch = rotations[safeIdx * 2];
             heading = rotations[safeIdx * 2 + 1];
        } else {
             // Fallback calculation
             if (safeIdx < maxIdx) {
                const nextX = positions[(safeIdx+1)*3];
                const nextZ = positions[(safeIdx+1)*3+2];
                heading = Math.atan2(nextX - vecPos.x, nextZ - vecPos.z);
            } else if (safeIdx > 0) {
                const prevX = positions[(safeIdx-1)*3];
                const prevZ = positions[(safeIdx-1)*3+2];
                heading = Math.atan2(vecPos.x - prevX, vecPos.z - prevZ);
            }

            if (safeIdx < maxIdx) {
                 const nextY = positions[(safeIdx + 1) * 3 + 1];
                 const nextX = positions[(safeIdx + 1) * 3];
                 const nextZ = positions[(safeIdx + 1) * 3 + 2];
                 const dy = nextY - vecPos.y;
                 const dist = Math.sqrt(Math.pow(nextX - vecPos.x, 2) + Math.pow(nextZ - vecPos.z, 2));
                 if (dist > 0.01) slopePitch = -Math.atan2(dy, dist);
            }
        }

        const frame = data ? data[safeIdx] : null;
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
                    const dirZ = gLong > 0 ? -1 : 1;
                    arrowLongRef.current.setDirection(new THREE.Vector3(0, 0, dirZ));
                    arrowLongRef.current.setLength(Math.min(Math.abs(gLong) * 5, 10), 1, 0.5);
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
      <mesh>
        <boxGeometry args={[2.5, 1.5, 5]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.2} transparent={transparent} opacity={opacity} />
      </mesh>
      {transparent && (
        <mesh>
            <boxGeometry args={[2.52, 1.52, 5.02]} />
            <meshBasicMaterial color="white" wireframe opacity={0.3} transparent />
        </mesh>
      )}
      <mesh position={[0, 0.5, 1]}>
        <boxGeometry args={[2.1, 0.8, 1.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.1} transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh position={[0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh position={[-0.8, 0, 2.4]}>
        <boxGeometry args={[0.5, 0.2, 0.2]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2} transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0, -2.5]}>
        <boxGeometry args={[2.2, 0.3, 0.1]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1} transparent={transparent} opacity={opacity} />
      </mesh>
      <mesh>
        <boxGeometry args={[12, 6, 16]} />
        <meshBasicMaterial color="white" wireframe opacity={0.05} transparent />
      </mesh>
      <arrowHelper ref={arrowLongRef} args={[new THREE.Vector3(0,0,1), new THREE.Vector3(0,2,0), 0, 0xffff00]} />
      <arrowHelper ref={arrowLatRef} args={[new THREE.Vector3(1,0,0), new THREE.Vector3(0,2,0), 0, 0xffff00]} />
    </group>
  );
};
