import { useState, useEffect, useRef } from 'react';
import type { TelemetryFrame } from '../utils/telemetryParser';

export interface SignalQuality {
  isThrottleActive: boolean;
  isBrakeActive: boolean;
  isGearActive: boolean;
  isSteeringActive: boolean;
  isGForceActive: boolean;
}

export function useSignalQuality(currentFrame: TelemetryFrame | null): SignalQuality {
  // Initialize as false. Once we see a non-zero value, we latch it to true.
  const [quality, setQuality] = useState<SignalQuality>({
    isThrottleActive: false,
    isBrakeActive: false,
    isGearActive: false,
    isSteeringActive: false,
    isGForceActive: false
  });

  // Refs to track latching without triggering re-renders for same state
  const latchedRef = useRef({
      throttle: false,
      brake: false,
      gear: false,
      steering: false,
      gForce: false
  });

  useEffect(() => {
    if (!currentFrame) return;

    let hasChange = false;
    const l = latchedRef.current;
    
    // Thresholds
    // Throttle/Brake: > 0 (or > 1 to be safe from noise, but 0.1 is fine)
    if (!l.throttle && currentFrame.throttle > 0.5) { l.throttle = true; hasChange = true; }
    if (!l.brake && currentFrame.brake > 0.5) { l.brake = true; hasChange = true; }
    if (!l.gear && currentFrame.gear !== 0) { l.gear = true; hasChange = true; }
    if (!l.steering && Math.abs(currentFrame.steering) > 0.5) { l.steering = true; hasChange = true; }
    
    // G-Force is tricky because 0 is valid, but usually there's noise or gravity
    // If we are moving, G-Force will be non-zero.
    if (!l.gForce && (Math.abs(currentFrame.gForceLat) > 0.02 || Math.abs(currentFrame.gForceLong) > 0.02)) { l.gForce = true; hasChange = true; }
    
    if (hasChange) {
        setQuality({
            isThrottleActive: l.throttle,
            isBrakeActive: l.brake,
            isGearActive: l.gear,
            isSteeringActive: l.steering,
            isGForceActive: l.gForce
        });
    }

  }, [currentFrame]); // Run on every frame to catch the first non-zero instance

  return quality;
}
