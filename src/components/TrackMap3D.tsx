import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';


interface TrackProps {
  positions: Float32Array;
}

const Track: React.FC<TrackProps> = React.memo(({ positions }) => {
  const geometry = useMemo(() => {
    if (positions.length === 0) return new THREE.BufferGeometry();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial attach="material" color="#00ff00" linewidth={2} />
    </line>
  );
});

interface CarProps {
  position: [number, number, number];
}

const Car: React.FC<CarProps> = ({ position }) => {
  return (
    <mesh position={position}>
      <sphereGeometry args={[5, 16, 16]} />
      <meshStandardMaterial color="red" emissive="red" emissiveIntensity={0.5} />
    </mesh>
  );
};

interface SceneContentProps {
  positions: Float32Array;
  currentIndex: number;
}

const SceneContent: React.FC<SceneContentProps> = ({ positions, currentIndex }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  // Initial camera position
  useEffect(() => {
      camera.position.set(0, 500, 500);
      camera.lookAt(0, 0, 0);
  }, [camera]);

  // Get current car position from the flat array
  const currentPos: [number, number, number] = useMemo(() => {
    if (currentIndex * 3 + 2 >= positions.length) return [0, 0, 0];
    return [
      positions[currentIndex * 3],
      positions[currentIndex * 3 + 1],
      positions[currentIndex * 3 + 2]
    ];
  }, [positions, currentIndex]);

  return (
    <>
      <OrbitControls ref={controlsRef} enableDamping />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1} />
      
      <Track positions={positions} />
      <Car position={currentPos} />

      {/* Ground Plane */}
      <gridHelper args={[2000, 50, 0x444444, 0x222222]} position={[0, -50, 0]} />
    </>
  );
};

interface TrackMap3DProps {
  positions: Float32Array;
  currentIndex: number;
}

export const TrackMap3D: React.FC<TrackMap3DProps> = ({ positions, currentIndex }) => {
  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden border border-gray-800">
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 200, 200]} fov={60} />
        <SceneContent positions={positions} currentIndex={currentIndex} />
      </Canvas>
      <div className="absolute top-4 right-4 text-xs text-gray-500 pointer-events-none">
        Left Click: Rotate | Right Click: Pan | Scroll: Zoom
      </div>
    </div>
  );
};
