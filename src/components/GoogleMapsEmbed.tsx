import React, { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';

interface GoogleMapsEmbedProps {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  className?: string;
}

export const GoogleMapsEmbed: React.FC<GoogleMapsEmbedProps> = ({ 
  latitude, 
  longitude, 
  zoom = 15,
  className = ""
}) => {
  const [src, setSrc] = useState<string>('');
  const lastUpdateRef = useRef<{lat: number, lon: number, time: number} | null>(null);
  
  // Update threshold: meters (approx) and time (ms) to avoid iframe flickering
  // 0.001 degrees is roughly 111 meters. Let's update every ~50-100m or 5 seconds?
  // Actually iframe reload is heavy. Let's do it sparingly.
  // Maybe only update if moved > 0.0005 degrees (approx 50m) OR it's been > 10 seconds?
  
  useEffect(() => {
    if (latitude === undefined || longitude === undefined) return;

    const now = Date.now();
    const last = lastUpdateRef.current;
    
    let shouldUpdate = false;
    
    if (!last) {
        shouldUpdate = true;
    } else {
        const timeDiff = now - last.time;
        const latDiff = Math.abs(latitude - last.lat);
        const lonDiff = Math.abs(longitude - last.lon);
        
        // Update if moved significantly (> ~50m) AND at least 2 seconds passed
        // OR if a lot of time passed (> 10s) and moved at all
        if (timeDiff > 2000 && (latDiff > 0.0005 || lonDiff > 0.0005)) {
            shouldUpdate = true;
        } else if (timeDiff > 10000 && (latDiff > 0.0001 || lonDiff > 0.0001)) {
            shouldUpdate = true;
        }
    }

    if (shouldUpdate) {
        // Use the output=embed legacy format which typically works without API key for simple display
        // Note: usage limits may apply, but for single user it's usually fine.
        const newSrc = `https://maps.google.com/maps?q=${latitude},${longitude}&t=k&z=${zoom}&ie=UTF8&iwloc=&output=embed`;
        setSrc(newSrc);
        lastUpdateRef.current = { lat: latitude, lon: longitude, time: now };
    }
  }, [latitude, longitude, zoom]);

  if (latitude === undefined || longitude === undefined) {
      return (
          <div className={`bg-gray-900 border border-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-xs font-mono p-4 ${className}`}>
              NO GPS SIGNAL
          </div>
      );
  }

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col relative group ${className}`} style={{ minWidth: '300px', height: '200px' }}>
      <iframe 
        width="100%" 
        height="100%" 
        src={src}
        frameBorder="0" 
        scrolling="no" 
        marginHeight={0} 
        marginWidth={0}
        title="Live GPS Location"
        className="flex-grow filter grayscale-[0.5] contrast-125 hover:grayscale-0 transition-all duration-500"
      />
      
      {/* Overlay Badge */}
      <div className="absolute top-2 right-2 bg-black/70 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-white/10">
          <MapPin size={10} className="text-red-500" />
          ADDR
      </div>
      
      <div className="absolute inset-0 pointer-events-none border border-white/5 rounded-lg ring-1 ring-inset ring-transparent group-hover:ring-white/10 transition-all" />
    </div>
  );
};
