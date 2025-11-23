import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Activity, ThumbsUp, TrendingUp, MessageSquare } from 'lucide-react';
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';

interface PerformanceCoachProps {
  currentFrame: TelemetryFrame | null;
  ghostFrame?: TelemetryFrame | null;
  idealLap?: LapData | null;
  currentIndex: number;
  laps: LapData[];
}

interface CoachMessage {
  id: number;
  text: string;
  type: 'positive' | 'neutral' | 'info';
  timestamp: number;
}

export const PerformanceCoach: React.FC<PerformanceCoachProps> = ({ currentFrame, ghostFrame, currentIndex, laps }) => {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const lastMessageTimeRef = useRef<number>(0);

  // Reset messages when restarting (index 0)
  useEffect(() => {
      if (currentIndex === 0) {
          setMessages([]);
          lastMessageTimeRef.current = 0;
      }
  }, [currentIndex]);

  const performance = useMemo(() => {
    if (!currentFrame || !ghostFrame) return null;

    // Calculate deltas
    const speedDelta = currentFrame.speed - ghostFrame.speed; // Positive means faster than ghost
    
    const speedMatch = Math.abs(speedDelta) < 5; // Within 5 km/h
    const gLatMatch = Math.abs(currentFrame.gForceLat - ghostFrame.gForceLat) < 0.2;
    const gLongMatch = Math.abs(currentFrame.gForceLong - ghostFrame.gForceLong) < 0.2;
    
    const isGoodLine = gLatMatch && gLongMatch;
    const isGoodSpeed = speedMatch;
    const isFaster = speedDelta > 5;

    return {
      speedDelta,
      isGoodLine,
      isGoodSpeed,
      isFaster
    };
  }, [currentFrame, ghostFrame]);

  // Message Generation Logic
  useEffect(() => {
    if (!performance || !currentFrame) return;

    const now = Date.now();
    // Limit message frequency (e.g., max 1 message every 3 seconds)
    if (now - lastMessageTimeRef.current < 3000) return;

    let newMessage: CoachMessage | null = null;

    // Helper to potentially add an emoji (10% chance)
    const withEmoji = (text: string, type: 'positive' | 'neutral' | 'info') => {
        if (Math.random() > 0.1) return text; // 90% chance of no emoji

        const emojis = {
            positive: ["🚀", "🔥", "🏎️", "⚡", "💪", "🎯", "📈", "💨"],
            neutral: ["✨", "⚖️", "👌", "🎯", "🧘‍♂️", "✅", "🤝"],
            info: ["📉", "⚠️", "🐢", "🤔", "👀"]
        };
        
        const emojiList = emojis[type];
        const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
        return `${emoji} ${text}`;
    };

    if (performance.isFaster) {
      const phrases = [
        "Great pace! You're gaining time!",
        "Flying! Keep it up!",
        "Faster than the ghost right now.",
        "Excellent exit speed!",
        "You're crushing this sector!",
        "Nailed that corner!",
        "Green sectors everywhere!",
        "Leave that ghost in the dust!"
      ];
      newMessage = {
        id: now,
        text: withEmoji(phrases[Math.floor(Math.random() * phrases.length)], 'positive'),
        type: 'positive',
        timestamp: now
      };
    } else if (performance.isGoodSpeed && performance.isGoodLine) {
      const phrases = [
        "Perfect line through here.",
        "Matching the ideal lap perfectly.",
        "Smooth inputs, looking good.",
        "Right on target.",
        "Flowing nicely.",
        "Consistent and clean.",
        "Staying right with the ghost."
      ];
      newMessage = {
        id: now,
        text: withEmoji(phrases[Math.floor(Math.random() * phrases.length)], 'neutral'),
        type: 'neutral',
        timestamp: now
      };
    } else if (performance.speedDelta < -10) {
       // Only give constructive feedback occasionally
       if (Math.random() > 0.6) {
           let phrases = [
               "Lost some speed there, try to carry more momentum.",
               "Losing time, push harder!"
           ];

           // Specific Feedback Logic
           if (ghostFrame) {
               const throttleDelta = ghostFrame.throttle - currentFrame.throttle;
               const brakeDelta = currentFrame.brake - ghostFrame.brake;
               const isCornering = Math.abs(currentFrame.gForceLat) > 0.5;
               const isCoasting = currentFrame.throttle < 5 && currentFrame.brake < 5;
               const gearMismatch = currentFrame.gear !== ghostFrame.gear;
               const steeringDelta = Math.abs(currentFrame.steering) - Math.abs(ghostFrame.steering);
               const brakePressureDelta = ghostFrame.brakePressure - currentFrame.brakePressure;
               const rpmDelta = ghostFrame.rpm - currentFrame.rpm;

               if (isCoasting && ghostFrame.throttle > 10) {
                   phrases = [
                       "Don't coast! Get back on power.",
                       "Too much hesitation between brake and throttle.",
                       "You're coasting, keep the momentum up.",
                       "Minimize the time off pedals.",
                       "No coasting allowed! Power or brakes.",
                       "You're floating. Commit to a pedal."
                   ];
               } else if (gearMismatch && currentFrame.gear > ghostFrame.gear) {
                   phrases = [
                       `Downshift! Ghost is in gear ${ghostFrame.gear}.`,
                       "Too high a gear for this corner.",
                       "Engine bogging? Drop a gear.",
                       "Use engine braking, downshift.",
                       `Ghost is using gear ${ghostFrame.gear}, try matching it.`,
                       "Revs are too low, shift down."
                   ];
               } else if (steeringDelta > 15 && isCornering) {
                   phrases = [
                       "You're scrubbing speed with too much steering.",
                       "Unwind the wheel, you're understeering.",
                       "Smoother steering inputs needed.",
                       "Let the car run wide on exit.",
                       "Fighting the wheel too much.",
                       "Less steering angle, more rotation."
                   ];
               } else if (brakePressureDelta > 10 && currentFrame.brake > 0) {
                   phrases = [
                       "Press the brake harder!",
                       "Ghost is braking with more pressure.",
                       "Maximize your braking efficiency.",
                       "Don't be afraid to stomp on the brakes.",
                       "More initial bite on the brakes.",
                       "Threshold braking! Push harder."
                   ];
               } else if (rpmDelta > 1000 && currentFrame.throttle > 90) {
                    phrases = [
                        "Shift up! You're hitting the limiter.",
                        "Late shift? Watch your RPMs.",
                        "Ghost shifted earlier.",
                        "Optimize your shift points.",
                        "Don't bounce off the limiter.",
                        "Shift now!"
                    ];
               } else if (throttleDelta > 20) {
                   if (isCornering) {
                       phrases = [
                           "Power out of the corner sooner.",
                           "Unwind the wheel and get on gas.",
                           "Late on throttle compared to ghost.",
                           "Trust the rear grip on exit.",
                           "Squeeze the throttle earlier.",
                           "Don't wait, get on the power."
                       ];
                   } else {
                       phrases = [
                           "Get on the gas earlier!",
                           "Hesitating on throttle? Commit!",
                           "Ghost is full throttle here, you should be too!",
                           "Flat out! Why are you lifting?",
                           "Full send! No lifting."
                       ];
                   }
               } else if (brakeDelta > 20) {
                   if (isCornering) {
                       phrases = [
                           "Trail braking too much?",
                           "Release the brake to let the car turn.",
                           "Overslowing mid-corner.",
                           "Off the brakes to rotate.",
                           "Let it roll through the apex."
                       ];
                   } else {
                       phrases = [
                           "Braking too early?",
                           "Trust the brakes, brake later.",
                           "Overslowing on entry.",
                           "Don't ride the brakes.",
                           "Brake later and harder.",
                           "Attack the braking zone."
                       ];
                   }
               } else if (isCornering && Math.abs(performance.speedDelta) > 15) {
                   phrases = [
                       "Minimum corner speed is too low.",
                       "Carry more speed to the apex.",
                       "Trust the grip mid-corner.",
                       "You're parking it on the apex.",
                       "Roll more speed in.",
                       "Don't overslow for the corner."
                   ];
               }
           }

           newMessage = {
               id: now,
               text: withEmoji(phrases[Math.floor(Math.random() * phrases.length)], 'info'),
               type: 'info',
               timestamp: now
           };
       }
    }

    if (newMessage) {
      setMessages(prev => [newMessage!, ...prev.slice(0, 49)]); // Prepend and keep last 50
      lastMessageTimeRef.current = now;
    }

  }, [performance, currentFrame, ghostFrame]);

  if (!currentFrame) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Waiting for telemetry...
      </div>
    );
  }

  if (!ghostFrame) {
      // Determine status
      let statusText = "Analyzing...";
      if (laps.length > 0) {
          if (currentFrame.time < laps[0].frames[0].time) {
              statusText = "Waiting to get into track...";
          } else {
              statusText = "You are off the track / Invalid Lap";
          }
      } else {
          statusText = "Waiting to get into track...";
      }

      return (
        <div className="flex items-center justify-center h-full text-gray-500 italic">
          {statusText}
        </div>
      );
  }

  return (
    <div className="flex-grow bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-800 pb-2 shrink-0">
        <Activity className="text-purple-500" size={20} />
        <h2 className="text-lg font-bold text-white">PERFORMANCE COACH</h2>
      </div>

      {/* HUD Section */}
      <div className="grid grid-cols-2 gap-4 shrink-0">
        {/* Speed Comparison */}
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
           <div className="text-xs text-gray-400 mb-1">Speed Delta</div>
           <div className={`text-3xl font-mono font-bold ${
               (performance?.speedDelta || 0) > 0 ? 'text-green-400' : 'text-red-400'
           }`}>
               {performance?.speedDelta ? (performance.speedDelta > 0 ? '+' : '') + performance.speedDelta.toFixed(1) : '0.0'} <span className="text-sm text-gray-500">km/h</span>
           </div>
        </div>

        {/* Status Icon */}
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 flex flex-col items-center justify-center text-center">
            {performance?.isGoodSpeed && performance?.isGoodLine ? (
                <ThumbsUp className="text-green-500" size={32} />
            ) : performance?.isFaster ? (
                <TrendingUp className="text-blue-500" size={32} />
            ) : (
                <Activity className="text-gray-600" size={32} />
            )}
            <div className="text-xs text-gray-400 mt-1">
                {performance?.isFaster ? 'GAINING' : performance?.isGoodLine ? 'MATCHING' : 'LOSING'}
            </div>
        </div>
      </div>
      
      {/* Streaming Chat Interface */}
      <div className="flex-grow bg-gray-950/50 rounded-lg border border-gray-800/50 flex flex-col overflow-hidden relative">
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-900/90 to-transparent z-10 pointer-events-none" />
          
          <div className="flex-grow overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {messages.length === 0 && (
                  <div className="text-center text-gray-600 text-sm mt-10 italic">
                      Coach is analyzing your driving...
                  </div>
              )}
              {messages.map((msg, index) => {
                  const isNewest = index === 0;
                  const opacity = Math.max(0.3, 1 - (index * 0.15)); // Fade out older messages
                  
                  return (
                  <div 
                    key={msg.id} 
                    className={`flex gap-3 transition-all duration-500 ${isNewest ? 'animate-in slide-in-from-top-2' : ''}`}
                    style={{ opacity }}
                  >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          msg.type === 'positive' ? 'bg-green-900/30 text-green-400' : 
                          msg.type === 'info' ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-800 text-gray-400'
                      } ${isNewest ? 'ring-2 ring-white/20 scale-110' : ''}`}>
                          <MessageSquare size={14} />
                      </div>
                      <div className="flex flex-col max-w-[85%]">
                          <div className={`rounded-2xl rounded-tl-none px-4 py-2 text-sm transition-all ${
                              msg.type === 'positive' ? 'bg-green-900/20 text-green-100 border border-green-900/30' : 
                              msg.type === 'info' ? 'bg-blue-900/20 text-blue-100 border border-blue-900/30' : 'bg-gray-800 text-gray-200'
                          } ${isNewest ? 'shadow-lg shadow-black/50 font-medium scale-[1.02] origin-left' : ''}`}>
                              {msg.text}
                          </div>
                          <span className="text-[10px] text-gray-600 mt-1 ml-1">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                          </span>
                      </div>
                  </div>
                  );
              })}
          </div>
      </div>

    </div>
  );
};
