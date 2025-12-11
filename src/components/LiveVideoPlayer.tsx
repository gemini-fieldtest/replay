import React, { useRef, useState, useEffect } from 'react';
import { Maximize, Volume2, VolumeX, Activity } from 'lucide-react';

interface LiveVideoPlayerProps {
  streamUrl?: string; // Optional for now, will default to placeholder or user input
  onVideoSelect?: (file: File) => void;
}

export const LiveVideoPlayer: React.FC<LiveVideoPlayerProps> = ({ streamUrl, onVideoSelect }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  
  // placeholder auto-play handling
  useEffect(() => {
    if (videoRef.current) {
        if (streamUrl) {
            videoRef.current.src = streamUrl;
        }
    }
  }, [streamUrl]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const toggleFullscreen = () => {
      if (videoRef.current) {
          if (!document.fullscreenElement) {
              videoRef.current.requestFullscreen().catch(err => console.error("Error attempting to enable fullscreen:", err));
          } else {
              document.exitFullscreen();
          }
      }
  };

  return (
    <div className="w-full aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-800 relative group flex flex-col items-center justify-center">
        
       {/* Video Feed */}
       {streamUrl ? (
           <video 
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted={isMuted}
                loop
           />
       ) : (
           <div className="flex flex-col items-center gap-4 text-gray-500">
               <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
                   <Activity size={32} />
               </div>
               <div className="flex flex-col items-center gap-2">
                   <div className="font-mono text-sm">NO VIDEO SOURCE</div>
                   {onVideoSelect && (
                       <label className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-bold transition-colors shadow-lg">
                           SELECT VIDEO FILE
                           <input 
                               type="file" 
                               accept="video/*" 
                               className="hidden" 
                               onChange={(e) => {
                                   const file = e.target.files?.[0];
                                   if (file) onVideoSelect(file);
                               }}
                           />
                       </label>
                   )}
               </div>
           </div>
       )}

       {/* Overlays */}
       <div className="absolute top-4 left-4 flex gap-2">
           <div className="bg-black/50 text-white text-xs font-mono px-2 py-1 rounded backdrop-blur-sm border border-white/10">
               DRIVER
           </div>
       </div>

       {/* Controls Overlay (Bottom) */}
       <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
           
           <div className="text-xs font-mono text-gray-300">
                {/* Source Picker in controls if video IS playing, to allow switching */}
                {streamUrl && onVideoSelect && (
                    <label className="cursor-pointer hover:text-white transition-colors flex items-center gap-2">
                        <span className="bg-gray-700 px-2 py-1 rounded text-[10px] uppercase font-bold">Change Video</span>
                        <input 
                            type="file" 
                            accept="video/*" 
                            className="hidden" 
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onVideoSelect(file);
                            }}
                        />
                    </label>
                )}
           </div>

           <div className="flex items-center gap-2">
               <button 
                  onClick={toggleMute}
                  className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
               >
                   {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
               </button>
               <button 
                  onClick={toggleFullscreen}
                  className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
               >
                   <Maximize size={16} />
               </button>
           </div>
       </div>

    </div>
  );
};
