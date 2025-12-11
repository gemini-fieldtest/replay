import React, { useMemo, useState, useEffect, useRef } from 'react';

import { Activity, ThumbsUp, TrendingUp, MessageSquare, Brain, Zap, Settings, ShieldAlert, Volume2 } from 'lucide-react';
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';
import { useGeminiNano } from '../hooks/useGeminiNano';
import { useGeminiCloud } from '../hooks/useGeminiCloud';
import { useTTS } from '../hooks/useTTS';
import { useSignalQuality } from '../hooks/useSignalQuality';
import { useTrackLocation, type TrackPoint } from '../hooks/useTrackLocation';
import { useDrivingAnalysis } from '../hooks/useDrivingAnalysis';

interface PerformanceCoachProps {
  currentFrame: TelemetryFrame | null;
  ghostFrame: TelemetryFrame | null;
  idealLap: LapData | null;
  currentIndex: number;
  laps: LapData[];
  trackPoints?: TrackPoint[];
  trackDetails?: string;
}

interface CoachMessage {
  id: number;
  text: string;
  type: 'positive' | 'neutral' | 'info';
  timestamp: number;
  mode?: 'code' | 'nano' | 'flash' | 'pro';
  telemetryTime: number;
  generationTime?: number;
}

type CoachMode = 'code' | 'nano' | 'flash' | 'pro';

export const PerformanceCoach: React.FC<PerformanceCoachProps> = ({ currentFrame, ghostFrame, currentIndex, laps, trackPoints = [], trackDetails = '' }) => {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [mode, setMode] = useState<CoachMode>('nano');
  const [showSettings, setShowSettings] = useState(false);
  const lastMessageTimeRef = useRef<number>(0);
  const { status: nanoStatus, generateFeedback: generateNano } = useGeminiNano();
  const { status: cloudStatus, generateFeedback: generateCloud, setApiKey } = useGeminiCloud();
  const signalQuality = useSignalQuality(currentFrame);
  const trackLocation = useTrackLocation(currentFrame, trackPoints);
  const drivingAnalysis = useDrivingAnalysis(currentFrame);
  const [settingsKey, setSettingsKey] = useState('');
  
  // TTS Hook
  const { 
    isEnabled: isAudioEnabled, 
    setIsEnabled: setIsAudioEnabled, 
    provider: audioProvider, 
    setProvider: setAudioProvider,
    speak 
  } = useTTS({ apiKey: settingsKey || localStorage.getItem('gemini_api_key') || '' });
  
  // New Settings State
  const [serializeRequests, setSerializeRequests] = useState(true);
  const [historyLength, setHistoryLength] = useState(100);

  // Reset messages when restarting (index 0)
  useEffect(() => {
      if (currentIndex === 0) {
           setTimeout(() => {
              setMessages([]);
              lastMessageTimeRef.current = 0;
           }, 0);
      }
  }, [currentIndex]);

  // Use performanceStats to avoid shadowing global performance object
  const performanceStats = useMemo(() => {
    if (!currentFrame || !ghostFrame) return null;

    // Calculate deltas
    const speedDelta = currentFrame.speed - ghostFrame.speed; // Positive means faster than ghost
    
    const speedMatch = Math.abs(speedDelta) < 5; // Within 5 km/h
    const gLatMatch = Math.abs(currentFrame.gForceLat - ghostFrame.gForceLat) < 0.2;
    const gLongMatch = Math.abs(currentFrame.gForceLong - ghostFrame.gForceLong) < 0.2;
    
    const isGoodLine = gLatMatch && gLongMatch;
    const isGoodSpeed = speedMatch;
    const isFaster = speedDelta > 5;
    
    // Catalyst "New Best" Logic (Simplified Sector Analysis)
    const isNewBest = speedDelta > 15 && isGoodLine;

    return {
      speedDelta,
      isGoodLine,
      isGoodSpeed,
      isFaster,
      isNewBest
    };
  }, [currentFrame, ghostFrame]);

  // Message Generation Logic
  useEffect(() => {
    if (!performanceStats || !currentFrame) return;

    const now = Date.now();
    // Limit message frequency
    if (now - lastMessageTimeRef.current < 3000) return;

    // Prevent overlapping requests if serialization is enabled
    if (serializeRequests) {
        if ((mode === 'flash' || mode === 'pro') && cloudStatus.state === 'loading') {
            return;
        }
    }
    

    // Async message generation wrapper
    const processMessage = async () => {
        let newMessage: CoachMessage | null = null;
        let msgType: 'positive' | 'neutral' | 'info' = 'info';
        
        const genStartTime = performance.now();

        // Context for AI models
        // Context for AI models
        let context = `
Speed: ${currentFrame.speed.toFixed(0)} km/h
Delta: ${performanceStats.speedDelta.toFixed(1)} km/h
`;
        if (signalQuality.isGearActive) context += `Gear: ${currentFrame.gear}\n`;
        if (signalQuality.isGForceActive) context += `Lat G: ${currentFrame.gForceLat.toFixed(2)}\n`;
        if (signalQuality.isThrottleActive) context += `Throttle: ${currentFrame.throttle.toFixed(0)}%\n`;
        if (signalQuality.isBrakeActive) context += `Brake: ${currentFrame.brake.toFixed(0)}%\n`;

        if (trackLocation) context += `Location: ${trackLocation}\n`;

        // Advanced Context
        if (drivingAnalysis.phase && drivingAnalysis.phase !== 'Straight') context += `Phase: ${drivingAnalysis.phase}\n`;
        context += `Grip Usage: ${drivingAnalysis.gripUsage}G\n`;
        if (drivingAnalysis.smoothnessScore < 70) context += `Smoothness: ${drivingAnalysis.smoothnessScore} (Rough)\n`;
        if (drivingAnalysis.gradient) context += `Gradient: ${drivingAnalysis.gradient}%\n`;
        if (drivingAnalysis.rpmBand === 'Over-rev') context += `RPM: ${currentFrame.rpm} (Over-revving!)\n`;

        if (trackDetails) context += `Track Info: ${trackDetails}\n`;

        context += `Status: ${performanceStats.isNewBest ? 'NEW BEST DETECTED' : performanceStats.isFaster ? 'GAINING TIME' : performanceStats.isGoodLine ? 'MATCHING PACE' : 'LOSING TIME'}\n`;
        context += `Directives: Use Catalyst vocabulary. If status is 'NEW BEST', say "New Best". Otherwise, give specific instruction like "Brake later".\n`;

        if (mode === 'nano' && nanoStatus.state === 'ready') {
            // Independent Generation Mode
            const nanoText = await generateNano(context);
            const genDuration = performance.now() - genStartTime;
            if (nanoText) {
                // Determine sentiment roughly based on performance
                if (performanceStats.isFaster) msgType = 'positive';
                else if (performanceStats.isGoodLine) msgType = 'neutral';
                else msgType = 'info';

                newMessage = {
                    id: now,
                    text: nanoText,
                    type: msgType,
                    timestamp: now,
                    mode: 'nano',
                    telemetryTime: currentFrame.time,
                    generationTime: genDuration
                };
            }
        } else {
            // "Code Coach" Heuristic Mode (for code, flash, pro)
            let baseText = "";
            if (performanceStats.isFaster) {
               if (performanceStats.isNewBest) {
                    baseText = "New Best.";
                    msgType = 'positive';
               } else {
                  const phrases = [
                    "Carrying good speed.",
                    "Gap increasing.",
                    "Sector fast.",
                    "Exit strong."
                  ];
                  if (Math.random() > 0.8) {
                    baseText = phrases[Math.floor(Math.random() * phrases.length)];
                  }
               }

            } else if (performanceStats.isGoodSpeed && performanceStats.isGoodLine) {
              const phrases = [
                "Line correct.",
                "Matching ideal lap.",
                "Inputs smooth.",
                "On target.",
                "Flow good.",
                "Consistent.",
                "With ghost."
              ];
              baseText = phrases[Math.floor(Math.random() * phrases.length)];
              msgType = 'neutral';

            } else if (performanceStats.speedDelta < -10) {
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
                       } else if (isCornering && Math.abs(performanceStats.speedDelta) > 15) {
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

                   baseText = phrases[Math.floor(Math.random() * phrases.length)];
                   msgType = 'info';
               }
            }

            if (baseText) {
                // Apply refinement based on mode
                let finalText = baseText;
                const currentMode = mode;

                // Context for AI models
                // Context for AI models
                let context = `
Speed: ${currentFrame.speed.toFixed(0)} km/h
Delta: ${performanceStats.speedDelta.toFixed(1)} km/h
`;
                if (signalQuality.isGearActive) context += `Gear: ${currentFrame.gear}\n`;
                if (signalQuality.isGForceActive) context += `Lat G: ${currentFrame.gForceLat.toFixed(2)}\n`;
                if (signalQuality.isThrottleActive) context += `Throttle: ${currentFrame.throttle.toFixed(0)}%\n`;
                if (signalQuality.isBrakeActive) context += `Brake: ${currentFrame.brake.toFixed(0)}%\n`;
                
                if (trackLocation) context += `Location: ${trackLocation}\n`;

                context += `Analysis: ${msgType === 'positive' ? 'Car is faster' : msgType === 'neutral' ? 'Car is matching pace' : 'Car is losing time'}
Reason: ${baseText}
`;

                if ((mode === 'flash' || mode === 'pro') && cloudStatus.hasKey) {
                    finalText = await generateCloud(mode, baseText, context);
                }
                
                const genDuration = performance.now() - genStartTime;

                newMessage = {
                    id: now,
                    text: finalText,
                    type: msgType,
                    timestamp: now,
                    mode: currentMode,
                    telemetryTime: currentFrame.time,
                    generationTime: genDuration
                };
            }
        }

        if (newMessage) {
            setMessages(prev => [newMessage!, ...prev.slice(0, historyLength - 1)]); // Respect historyLength
            lastMessageTimeRef.current = now;
            
            // Speak the message!
            if (newMessage.text) {
                speak(newMessage.text);
            }
        }
    };

    processMessage();
  }, [performanceStats, currentFrame, ghostFrame, mode, nanoStatus.state, generateNano, cloudStatus.hasKey, generateCloud, serializeRequests, historyLength, cloudStatus.state, speak, signalQuality, trackLocation]);

  const toggleSettings = () => {
      setShowSettings(!showSettings);
      if (!showSettings) {
          setSettingsKey(localStorage.getItem('gemini_api_key') || '');
      }
  };

  const handleSaveKey = () => {
      setApiKey(settingsKey);
      setShowSettings(false);
  };

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
    <div className="flex-grow bg-gray-900 rounded-lg border border-gray-800 p-4 flex flex-col gap-4 h-full overflow-hidden relative">
      {/* Settings Modal */}
      {showSettings && (
          <div className="absolute inset-0 z-50 bg-gray-900/95 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
                  <div className="flex items-center gap-2 mb-4 text-purple-400">
                      <Settings size={20} />
                      <h3 className="font-bold text-lg">Coach Settings</h3>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs text-gray-400 mb-1 ml-1">Gemini API Key</label>
                          <input 
                              type="password"
                              value={settingsKey}
                              onChange={(e) => setSettingsKey(e.target.value)}
                              placeholder="Enter your API Key"
                              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 placeholder-gray-600 font-mono"
                          />
                          <p className="text-[10px] text-gray-500 mt-2">
                              Required for Flash and Pro modes. Your key is stored locally in your browser.
                          </p>
                      </div>

                      <div className="border-t border-gray-700 pt-3">
                          <label className="flex items-center gap-2 cursor-pointer mb-2">
                              <input 
                                  type="checkbox"
                                  checked={serializeRequests}
                                  onChange={(e) => setSerializeRequests(e.target.checked)}
                                  className="w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 bg-gray-900"
                              />
                              <span className="text-sm text-gray-300">Serialize Requests</span>
                          </label>
                          <p className="text-[10px] text-gray-500 ml-6">
                              Wait for the previous AI response before sending a new one. Reduces API usage and errors.
                          </p>
                      </div>

                      <div className="border-t border-gray-700 pt-3">
                          <label className="block text-xs text-gray-400 mb-1 ml-1">Message History</label>
                          <input 
                              type="number"
                              min={1}
                              value={historyLength}
                              onChange={(e) => setHistoryLength(Math.max(1, parseInt(e.target.value) || 50))}
                              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 placeholder-gray-600 font-mono"
                          />
                          <p className="text-[10px] text-gray-500 mt-2">
                              Number of previous messages to keep visible.
                          </p>
                      </div>
                      
                      <div className="flex gap-2 pt-2 border-t border-gray-700 mt-2">
                          <button 
                              onClick={() => setShowSettings(false)}
                              className="flex-1 px-4 py-2 rounded-lg text-xs font-bold text-gray-400 hover:bg-gray-700 transition-colors"
                          >
                              DONE
                          </button>
                          <button 
                              onClick={handleSaveKey}
                              className="flex-1 px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-500 shadow-lg transition-all"
                          >
                              SAVE KEY
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      <div className="flex items-center justify-between border-b border-gray-800 pb-2 shrink-0">
        <div className="flex items-center gap-3">
            <Activity className="text-purple-500" size={20} />
            <h2 className="text-lg font-bold text-white">PERFORMANCE COACH</h2>
        </div>
        
        <div className="flex items-center gap-4">
            {/* Intelligence Group */}
            <div className="flex items-center gap-2">
                <Brain size={16} className="text-purple-400" />
                <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
                    {(['code', 'nano', 'flash', 'pro'] as CoachMode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${
                                mode === m 
                                    ? 'bg-purple-600 text-white shadow-lg' 
                                    : 'text-gray-400 hover:text-gray-200'
                            }`}
                        >
                           {m}
                        </button>
                    ))}
                </div>
            </div>

            {/* Audio Group */}
            <div className="flex items-center gap-2 pl-4 border-l border-gray-700">
                <Volume2 size={16} className="text-blue-400" />
                <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
                    <button
                        onClick={() => setIsAudioEnabled(false)}
                        className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold transition-all flex items-center gap-1 ${
                            !isAudioEnabled
                                ? 'bg-gray-700 text-white shadow-lg'
                                : 'text-gray-400 hover:text-gray-200'
                        }`}
                        title="Audio Off"
                    >
                        OFF
                    </button>
                    <button
                        onClick={() => { setIsAudioEnabled(true); setAudioProvider('browser'); }}
                        className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${
                            isAudioEnabled && audioProvider === 'browser'
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        NATIVE
                    </button>
                    <button
                        onClick={() => { setIsAudioEnabled(true); setAudioProvider('google'); }}
                        className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${
                            isAudioEnabled && audioProvider === 'google'
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        GEMINI
                    </button>
                </div>
            </div>
            
            <button  
                onClick={toggleSettings}
                className={`p-1.5 rounded-lg transition-colors ${showSettings || cloudStatus.hasKey ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-yellow-500 animate-pulse bg-yellow-500/10'}`}
                title="Settings"
            >
                <Settings size={16} />
            </button>
        </div>
      </div> 

      
      {/* API Key Warning for Cloud Modes */}
      {(mode === 'flash' || mode === 'pro') && !cloudStatus.hasKey && (
          <div className="bg-red-500/10 border border-red-500/20 rounded p-2 flex items-center gap-2 text-xs text-red-400">
              <ShieldAlert size={14} />
              <span>Missing VITE_GEMINI_API_KEY for {mode.toUpperCase()} mode.</span>
          </div>
      )}

      {/* HUD Section */}
      <div className="grid grid-cols-2 gap-4 shrink-0">
        {/* Speed Comparison */}
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
           <div className="text-xs text-gray-400 mb-1">Speed Delta</div>
           <div className={`text-3xl font-mono font-bold ${
               (performanceStats?.speedDelta || 0) > 0 ? 'text-green-400' : 'text-red-400'
           }`}>
               {performanceStats?.speedDelta ? (performanceStats.speedDelta > 0 ? '+' : '') + performanceStats.speedDelta.toFixed(1) : '0.0'} <span className="text-sm text-gray-500">km/h</span>
           </div>
        </div>

        {/* Status Icon */}
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 flex flex-col items-center justify-center text-center">
            {performanceStats?.isGoodSpeed && performanceStats?.isGoodLine ? (
                <ThumbsUp className="text-green-500" size={32} />
            ) : performanceStats?.isFaster ? (
                <TrendingUp className="text-blue-500" size={32} />
            ) : (
                <Activity className="text-gray-600" size={32} />
            )}
            <div className="text-xs text-gray-400 mt-1">
                {performanceStats?.isFaster ? 'GAINING' : performanceStats?.isGoodLine ? 'MATCHING' : 'LOSING'}
            </div>
        </div>
      </div>
      
      {/* Streaming Chat Interface */}
      <div className="h-[600px] bg-gray-950/50 rounded-lg border border-gray-800/50 flex flex-col overflow-hidden relative">
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-900/90 to-transparent z-10 pointer-events-none" />
          
          <div className="flex-grow overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {messages.length === 0 && (
                  <div className="text-center text-gray-600 text-sm mt-10 italic">
                      Coach is analyzing your driving...
                  </div>
              )}
              {messages.map((msg, index) => {
                  const isNewest = index === 0;
                  const opacity = Math.max(0.3, 1 - (index * 0.05)); // Slower fade out since we have more messages
                  
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
                          <span className="text-[10px] text-gray-600 mt-1 ml-1 flex items-center gap-2 flex-wrap">
                              <span>
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className="text-gray-500 border-l border-gray-700 pl-2">
                                T+{msg.telemetryTime.toFixed(1)}s
                              </span>
                              
                              {msg.mode === 'nano' && (
                                  <>
                                  <span className="inline-flex items-center gap-1 text-indigo-400 border-l border-gray-700 pl-2" title="Refined by Nano">
                                      <Brain size={10} /> Nano
                                  </span>
                                  {msg.generationTime && <span className="text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                  </>
                              )}
                              {msg.mode === 'flash' && (
                                  <>
                                  <span className="inline-flex items-center gap-1 text-yellow-500 border-l border-gray-700 pl-2" title="Refined by Flash">
                                      <Zap size={10} /> Flash
                                  </span>
                                  {msg.generationTime && <span className="text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                  </>
                              )}
                              {msg.mode === 'pro' && (
                                  <>
                                  <span className="inline-flex items-center gap-1 text-purple-400 border-l border-gray-700 pl-2" title="Refined by Pro">
                                      <Settings size={10} /> Pro
                                  </span>
                                  {msg.generationTime && <span className="text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                  </>
                              )}
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
