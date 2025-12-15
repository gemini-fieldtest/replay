import { useMemo, useState, useEffect, useRef } from 'react';

import { Activity, ThumbsUp, TrendingUp, MessageSquare, Brain, Volume2 } from 'lucide-react';
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';
import { useGeminiNano } from '../hooks/useGeminiNano';
import { useTTS } from '../hooks/useTTS';
import { useSignalQuality } from '../hooks/useSignalQuality';
import { useTrackLocation, type TrackPoint } from '../hooks/useTrackLocation';
import { useDrivingAnalysis } from '../hooks/useDrivingAnalysis';
import ReactMarkdown from 'react-markdown';
import { MAIN_COACH_SYSTEM_PROMPT, DECISION_MATRIX_RULES } from '../utils/coachingKnowledge';
import { usePredictiveCoaching } from '../hooks/usePredictiveCoaching';

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
    mode?: CoachMode;
    telemetryTime: number;
    generationTime?: number;
    analysis?: string;
    isPredictive?: boolean;
}



const loadingMessages = [
    "Calibrating sensors...",
    "Warming up tires...",
    "Checking ghost data...",
    "Analyzing corner entries...",
    "Calculating optimal lines...",
    "Reviewing sector split times...",
    "Syncing telemetry..."
];

type CoachMode = 'code' | 'nano' | 'flash' | 'pro';
type CoachingStrategy = 'reactive' | 'predictive';

export const RealtimeCoach = ({ currentFrame, ghostFrame, currentIndex, laps, idealLap, trackPoints = [], trackDetails = '' }: PerformanceCoachProps) => {
    const [messages, setMessages] = useState<CoachMessage[]>([]);
    const [mode, setMode] = useState<CoachMode>('nano');
    const [strategy, setStrategy] = useState<CoachingStrategy>('reactive');
    const lastMessageTimeRef = useRef<number>(0);
    const { status: nanoStatus, generateFeedback: generateNano, initSession } = useGeminiNano();
    const signalQuality = useSignalQuality(currentFrame);
    const trackLocation = useTrackLocation(currentFrame, trackPoints);
    const drivingAnalysis = useDrivingAnalysis(currentFrame);

    // Predictive Coach Hook
    const { getAdvice: getPredictiveAdvice } = usePredictiveCoaching({
        laps,
        currentFrame,
        idealLap,
        isEnabled: strategy === 'predictive'
    });

    // TTS Hook
    const {
        isEnabled: isAudioEnabled,
        setIsEnabled: setIsAudioEnabled,
        provider: audioProvider,
        setProvider: setAudioProvider,
        speak
    } = useTTS({ apiKey: '' });

    const historyLength = 100;

    const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

    const getUrgencyOptions = (text: string) => {
        const upper = text.toUpperCase();
        if (upper.includes("STABILIZE") || upper.includes("BRAKE") || upper.includes("PANIC")) {
            return { rate: 1.5, pitch: 1.1 }; // Urgent
        }
        if (upper.includes("SMOOTH") || upper.includes("MAINTAIN")) {
            return { rate: 0.9, pitch: 0.9 }; // Calm
        }
        return { rate: 1.1, pitch: 1.0 }; // Standard 'Race Engineer' pace (slightly fast)
    };

    useEffect(() => {
        if (messages.length > 0) return;
        const interval = setInterval(() => {
            setLoadingMessageIndex(i => (i + 1) % loadingMessages.length);
        }, 2000);
        return () => clearInterval(interval);
    }, [messages.length]);

    // Reset messages when restarting (index 0)
    useEffect(() => {
        if (currentIndex === 0) {
            // Defer state update to next tick to avoid synchronous render warning
            setTimeout(() => {
                setMessages([]);
                lastMessageTimeRef.current = 0;
            }, 0);
        }
    }, [currentIndex]);

    // Init Session with Main Persona
    useEffect(() => {
        if (mode === 'nano') {
            initSession(MAIN_COACH_SYSTEM_PROMPT);
        }
    }, [mode, initSession]);

    // const { speak: speakSynthesis } = useSpeechSynthesis(); // Removed unused

    // const lastSectorRef = useRef<number>(-1); // Removed unused
    const deviationStartTimeRef = useRef<number | null>(null);
    const lastTrackLocationRef = useRef<string | null>(null);
    const lastHillStateRef = useRef<'uphill' | 'downhill' | 'flat'>('flat');
    const lastTriggerTimeRef = useRef<number>(0); // This replaces lastMessageTimeRef for trigger logic

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
        // If we are significantly faster (>10km/h) for a sustained period, consider it a potential new best segment
        const isNewBest = speedDelta > 15 && isGoodLine;

        return {
            speedDelta,
            isGoodLine,
            isGoodSpeed,
            isFaster,
            isNewBest
        };
    }, [currentFrame, ghostFrame]);

    // Helper function to get coach message (extracted from original heuristic logic)
    const getCoachMessage = (perfStats: NonNullable<typeof performanceStats>, _drivingAnalysis: ReturnType<typeof useDrivingAnalysis>, currentFrame: TelemetryFrame, ghostFrame: TelemetryFrame | null): { text: string; type: 'positive' | 'neutral' | 'info' } => {
        let baseText = "";
        let msgType: 'positive' | 'neutral' | 'info' = 'info';

        if (perfStats.isFaster) {
            if (perfStats.isNewBest) {
                baseText = "New Best.";
                msgType = 'positive';
            } else {
                const phrases = [
                    "Pace is good. Maintain.", "Sectors green. Keep pushing.", "Faster. Hold line.",
                    "Exit speed sufficient.", "Sector fast.", "Corner nailed.", "Gap increasing."
                ];
                baseText = phrases[Math.floor(Math.random() * phrases.length)];
            }
        } else if (perfStats.isGoodSpeed && perfStats.isGoodLine) {
            const phrases = [
                "Line correct.", "Matching ideal lap.", "Inputs smooth.", "On target.", "Flow good.", "Consistent."
            ];
            baseText = phrases[Math.floor(Math.random() * phrases.length)];
            msgType = 'neutral';
        } else if (perfStats.speedDelta < -10) {
            let phrases = [
                "Lost some speed there, try to carry more momentum.",
                "Losing time, push harder!"
            ];

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
                    phrases = ["Don't coast! Get back on power.", "Too much hesitation between brake and throttle.", "You're coasting, keep the momentum up.", "Minimize the time off pedals.", "No coasting allowed! Power or brakes.", "You're floating. Commit to a pedal."];
                } else if (gearMismatch && currentFrame.gear > ghostFrame.gear) {
                    phrases = [`Downshift! Gear ${ghostFrame.gear} recommended.`, "Too high a gear for this corner.", "Engine bogging? Drop a gear.", "Use engine braking, downshift.", `Recommended gear: ${ghostFrame.gear}.`, "Revs are too low, shift down."];
                } else if (steeringDelta > 15 && isCornering) {
                    phrases = ["You're scrubbing speed with too much steering.", "Unwind the wheel, you're understeering.", "Smoother steering inputs needed.", "Let the car run wide on exit.", "Fighting the wheel too much.", "Less steering angle, more rotation."];
                } else if (brakePressureDelta > 10 && currentFrame.brake > 0) {
                    phrases = ["Press the brake harder!", "More brake pressure required.", "Maximize your braking efficiency.", "Don't be afraid to stomp on the brakes.", "More initial bite on the brakes.", "Threshold braking! Push harder."];
                } else if (rpmDelta > 1000 && currentFrame.throttle > 90) {
                    phrases = ["Shift up! You're hitting the limiter.", "Late shift? Watch your RPMs.", "Shift earlier.", "Optimize your shift points.", "Don't bounce off the limiter.", "Shift now!"];
                } else if (throttleDelta > 20) {
                    if (isCornering) {
                        phrases = ["Power out of the corner sooner.", "Unwind the wheel and get on gas.", "Late on throttle.", "Trust the rear grip on exit.", "Squeeze the throttle earlier.", "Don't wait, get on the power."];
                    } else {
                        phrases = ["Get on the gas earlier!", "Hesitating on throttle? Commit!", "Full throttle required!", "Flat out! Why are you lifting?", "Full send! No lifting."];
                    }
                } else if (brakeDelta > 20) {
                    if (isCornering) {
                        phrases = ["Trail braking too much?", "Release the brake to let the car turn.", "Overslowing mid-corner.", "Off the brakes to rotate.", "Let it roll through the apex."];
                    } else {
                        phrases = ["Braking too early?", "Trust the brakes, brake later.", "Overslowing on entry.", "Don't ride the brakes.", "Brake later and harder.", "Attack the braking zone."];
                    }
                } else if (isCornering && Math.abs(perfStats.speedDelta) > 15) {
                    phrases = ["Minimum corner speed is too low.", "Carry more speed to the apex.", "Trust the grip mid-corner.", "You're parking it on the apex.", "Roll more speed in.", "Don't overslow for the corner."];
                }
            }
            baseText = phrases[Math.floor(Math.random() * phrases.length)];
            msgType = 'info';
        }
        return { text: baseText, type: msgType };
    };


    // Message Generation Logic
    useEffect(() => {
        if (!performanceStats || !currentFrame) return;

        const now = Date.now();
        //. Limit message frequency (original logic)
        // if (now - lastMessageTimeRef.current < 3000) return; // This is now handled by trigger logic cooldown

        // Context for AI models
        let context = `
Speed: ${currentFrame.speed.toFixed(0)} km/h
Delta: ${performanceStats.speedDelta.toFixed(1)} km/h
`;
        if (signalQuality.isGearActive && currentFrame.gear !== 255) context += `Gear: ${currentFrame.gear}\n`;
        if (signalQuality.isGForceActive) context += `Lat G: ${currentFrame.gForceLat.toFixed(2)}\n`;
        const throttleVal = currentFrame.throttle < 2 ? 0 : currentFrame.throttle;
        const brakeVal = currentFrame.brake < 2 ? 0 : currentFrame.brake;

        if (signalQuality.isThrottleActive) context += `Throttle: ${throttleVal.toFixed(0)}%\n`;
        if (signalQuality.isBrakeActive) context += `Brake: ${brakeVal.toFixed(0)}%\n`;

        // Generic Location Logic (Use "Turn" instead of "Turn 9")
        // Check for undefined trackLocation to avoid issues
        const genericLocation = trackLocation ? trackLocation.replace(/Turn \d+/, "Turn") : null;
        if (genericLocation) context += `Location: ${genericLocation}\n`;

        // Advanced Context
        if (drivingAnalysis.phase && drivingAnalysis.phase !== 'Straight') context += `Phase: ${drivingAnalysis.phase}\n`;
        context += `Grip Usage: ${drivingAnalysis.gripUsage}G\n`;
        if (drivingAnalysis.smoothnessScore < 70) context += `Smoothness: ${drivingAnalysis.smoothnessScore} (Rough)\n`;
        if (drivingAnalysis.gradient) context += `Gradient: ${drivingAnalysis.gradient}%\n`;
        if (drivingAnalysis.rpmBand === 'Over-rev') context += `RPM: ${currentFrame.rpm} (Over-revving!)\n`;

        if (trackDetails) context += `Track Info: ${trackDetails}\n`;

        context += `Status: ${performanceStats.isNewBest ? 'NEW BEST DETECTED' : performanceStats.isFaster ? 'GAINING TIME' : performanceStats.isGoodLine ? 'MATCHING PACE' : 'LOSING TIME'}\n`;

        // Inject Teaching Knowledge
        context += `\n${DECISION_MATRIX_RULES}\n`;
        context += `Directives: Analyze utilizing the Chief Engineer philosophy.\n`;

        // --- PREDICTIVE STRATEGY LOGIC ---
        let messageText: string | null = null;
        let messageType: 'positive' | 'neutral' | 'info' = 'info';

        if (strategy === 'predictive') {
            const predictiveMsg = getPredictiveAdvice();
            if (predictiveMsg) {
                messageText = predictiveMsg.text;
                messageType = predictiveMsg.type;
            }
        }

        // Strategy Enforcement
        if (strategy === 'predictive' && !messageText) return; // Strict mode

        if (!messageText) {
            // ... Your existing heuristic fallback or getCoachMessage logic ...
            // Since RealtimeCoach uses custom inline logic mostly:
            const heuristic = getCoachMessage(performanceStats, drivingAnalysis, currentFrame, ghostFrame);
            messageText = heuristic.text;
            messageType = heuristic.type;
        }

        // --- TRIGGER LOGIC ---
        const timeSinceLastTrigger = now - lastTriggerTimeRef.current;
        let shouldTrigger = false;

        // A. Pace Deviation Trigger
        // If speed delta > 10 km/h (approx 10%) for > 3 seconds
        if (Math.abs(performanceStats.speedDelta) > 10) {
            if (!deviationStartTimeRef.current) {
                deviationStartTimeRef.current = now;
            } else if (now - deviationStartTimeRef.current > 3000) {
                // Sustained deviation
                shouldTrigger = true;
            }
        } else {
            deviationStartTimeRef.current = null;
        }

        // B. Hill Trigger (Gradient Change)
        // Threshold: 3% slope
        // Threshold: 3% slope
        const currentGradient = drivingAnalysis.gradient || 0;
        let hillState: 'uphill' | 'downhill' | 'flat' = 'flat';
        if (currentGradient > 3) hillState = 'uphill';
        else if (currentGradient < -3) hillState = 'downhill';

        if (hillState !== lastHillStateRef.current) {
            shouldTrigger = true;
            lastHillStateRef.current = hillState;
        }

        // C. explicit "New Best" Trigger (from previous logic)
        if (performanceStats.isNewBest) {
            shouldTrigger = true;
        }

        // D. Location Change Trigger (Generic)
        if (genericLocation && genericLocation !== lastTrackLocationRef.current) {
            lastTrackLocationRef.current = genericLocation;
            // Trigger when entering a new generic phase (e.g. Straight -> Turn)
            // Use slightly shorter cooldown for location changes to ensure we catch the corner entry
            if (timeSinceLastTrigger > 5000) {
                shouldTrigger = true;
            }
        }



        // Global Cooldown (don't spam, even if triggers overlap)
        // Minimum 5 seconds between messages unless it's critical? Let's say 8s.
        const COOLDOWN = 8000;

        if (shouldTrigger && timeSinceLastTrigger > COOLDOWN) {

            const heuristicMessage = getCoachMessage(performanceStats, drivingAnalysis, currentFrame, ghostFrame);

            // Code Coach (Always Runs OR Fallback if Nano unavailable)
            // If mode is Nano but it's not ready, use Code heuristics as fallback
            const useHeuristic = mode === 'code' || (mode === 'nano' && nanoStatus.state !== 'ready');

            if (useHeuristic) {
                const newMessage: CoachMessage = {
                    id: now,
                    text: heuristicMessage.text,
                    type: heuristicMessage.type,
                    timestamp: now,
                    mode: 'code',
                    telemetryTime: currentFrame.time,
                    generationTime: 0 // Heuristic, no generation time
                };
                setTimeout(() => {
                    setMessages(prev => [newMessage, ...prev.slice(0, historyLength - 1)]);
                    if (isAudioEnabled) {
                        const urgency = getUrgencyOptions(newMessage.text);
                        speak(newMessage.text, urgency);
                    }
                    lastTriggerTimeRef.current = now;
                }, 0);
            }

            // Gemini Nano (Middleware Mode)
            else if (mode === 'nano' && nanoStatus.state === 'ready') {

                // --- MIDDLEWARE FLAGS (Enhanced with RaceMath) ---
                const flags: Record<string, string> = {
                    safety_status: "STABLE",
                    error_type: "NONE",
                    tire_usage: "OPTIMAL",
                    driver_state: "NORMAL",
                    opportunity: "NONE",
                    urgent_correction: "NONE"
                };

                // 1. Safety & Errors (From RaceMath)
                if (drivingAnalysis.safetyFlags.includes("COASTING_DETECTED")) {
                    flags.error_type = "COASTING_DETECTED";
                }
                if (drivingAnalysis.safetyFlags.includes("PANIC_BRAKE_IN_TURN")) {
                    flags.driver_state = "PANIC";
                    flags.urgent_correction = "PANIC_BRAKE_IN_TURN";
                }

                // 2. Tire Usage (From RaceMath Friction Circle)
                if (drivingAnalysis.tireStatus === 'COLD_OR_CRUISING' || drivingAnalysis.tireStatus === 'UNDER_DRIVING') {
                    // Contextualize: Only "Low" if in a corner
                    if (drivingAnalysis.phase !== 'Straight') {
                        flags.tire_usage = "LOW";
                    }
                } else if (drivingAnalysis.tireStatus === 'OVER_DRIVING') {
                    flags.tire_usage = "OVER_COMPRESSED";
                }



                const payload = {
                    context: {
                        location: genericLocation || "Track",
                        speed: Math.round(currentFrame.speed),
                        tire_status: drivingAnalysis.tireStatus, // Pass raw status too
                        grip_pct: drivingAnalysis.tireUsagePct     // Pass raw pct too
                    },
                    flags,
                    delta: performanceStats?.speedDelta.toFixed(1)
                };

                const genStartTime = performance.now();
                generateNano(payload).then(nanoText => { // Pass Object Payload
                    const genDuration = performance.now() - genStartTime;
                    if (nanoText && nanoText !== "SILENT") { // Handle SILENT case if prompt uses it (Wait, new prompt doesn't say SILENT explicitly but implies specific outputs)
                        const newMessage: CoachMessage = {
                            id: now,
                            text: nanoText,
                            type: 'info', // Nano is mostly instructional now
                            timestamp: now,
                            mode: 'nano',
                            telemetryTime: currentFrame.time,
                            generationTime: genDuration,
                            analysis: JSON.stringify(payload, null, 2)
                        };
                        setMessages(prev => [newMessage, ...prev.slice(0, historyLength - 1)]);
                        if (isAudioEnabled) {
                            const urgency = getUrgencyOptions(newMessage.text);
                            speak(newMessage.text, urgency);
                        }
                    }
                });
                lastTriggerTimeRef.current = now;
            }

            // Gemini Cloud (flash/pro)
            else if ((mode === 'flash' || mode === 'pro')) {
                // Placeholder: generateCloud(mode, contextString);
                // Since RealtimeCoach uses a different hook or logic for cloud than PerformanceCoach in some versions,
                // I'll assume consistent usage or just leave this placeholder as is, but ensure no heuristic passed if fully implemented.
                // Looking at previous RealtimeCoach code, it had: generateCloudFeedback(contextString, heuristicMessage.text);
                // I should update that if it exists.
                // Checking view in step 185, it seems RealtimeCoach Cloud implementation was commented out or simplified?
                // Actually it constructed a fake message "Cloud coach triggered...".
                // So I just need to update Nano part which is active.
            }
        }

    }, [
        currentFrame, // currentFrame.time is implicitly a dependency
        performanceStats,
        drivingAnalysis, // Dependency for gradient
        mode, nanoStatus.state, isAudioEnabled, speak, generateNano, historyLength, ghostFrame,
        signalQuality, trackLocation, trackDetails // Added for context string
    ]);



    if (!currentFrame) {
        return (
            <div className="flex items-center justify-center h-full text-gray-500">
                Waiting for telemetry...
            </div>
        );
    }



    return (
        <div className="flex-grow bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-4 h-full overflow-hidden relative shadow-sm">


            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Activity className="text-purple-600 dark:text-purple-500" size={20} />
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">REALTIME COACH</h2>
                </div>

                <div className="flex items-center gap-4">
                    {/* Strategy Group */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 border border-gray-200 dark:border-gray-700">
                            <button
                                onClick={() => setStrategy('reactive')}
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${strategy === 'reactive'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                            >
                                Reactive
                            </button>
                            <button
                                onClick={() => setStrategy('predictive')}
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all flex items-center gap-1 ${strategy === 'predictive'
                                    ? 'bg-teal-600 text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                            >
                                <TrendingUp size={10} />
                                Predictive
                            </button>
                        </div>
                    </div>

                    {/* Intelligence Group */}
                    <div className="flex items-center gap-2 border-l border-gray-200 dark:border-gray-700 pl-4">
                        <Brain size={16} className="text-purple-400" />
                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                            {(['code', 'nano', 'flash', 'pro'] as CoachMode[]).map((m) => (
                                <button
                                    key={m}
                                    onClick={() => setMode(m)}
                                    className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${mode === m
                                        ? 'bg-purple-600 text-white shadow-lg'
                                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
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
                        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                            <button
                                onClick={() => setIsAudioEnabled(false)}
                                className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold transition-all flex items-center gap-1 ${!isAudioEnabled
                                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                                title="Audio Off"
                            >
                                OFF
                            </button>
                            <button
                                onClick={() => { setIsAudioEnabled(true); setAudioProvider('browser'); }}
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${isAudioEnabled && audioProvider === 'browser'
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                            >
                                NATIVE
                            </button>
                            <button
                                onClick={() => { setIsAudioEnabled(true); setAudioProvider('gemini-flash'); }}
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${isAudioEnabled && audioProvider === 'gemini-flash'
                                    ? 'bg-purple-600 text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                                title="Gemini 2.5 Flash Audio"
                            >
                                FLASH
                            </button>
                            <button
                                onClick={() => { setIsAudioEnabled(true); setAudioProvider('gemini-pro'); }}
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${isAudioEnabled && audioProvider === 'gemini-pro'
                                    ? 'bg-purple-600 text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                                title="Gemini 1.5 Pro Audio"
                            >
                                PRO
                            </button>

                        </div>
                    </div>


                </div>
            </div>




            {/* HUD Section */}
            <div className="grid grid-cols-2 gap-4 shrink-0">
                {/* Speed Comparison */}
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Speed Delta</div>
                    <div className={`text-3xl font-mono font-bold ${(performanceStats?.speedDelta || 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                        {performanceStats?.speedDelta ? (performanceStats.speedDelta > 0 ? '+' : '') + performanceStats.speedDelta.toFixed(1) : '0.0'} <span className="text-sm text-gray-400 dark:text-gray-500">km/h</span>
                    </div>
                </div>

                {/* Status Icon */}
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-center shadow-sm">
                    {performanceStats?.isGoodSpeed && performanceStats?.isGoodLine ? (
                        <ThumbsUp className="text-green-600 dark:text-green-500" size={32} />
                    ) : performanceStats?.isFaster ? (
                        <TrendingUp className="text-blue-600 dark:text-blue-500" size={32} />
                    ) : (
                        <Activity className="text-gray-400 dark:text-gray-600" size={32} />
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {performanceStats?.isFaster ? 'GAINING' : performanceStats?.isGoodLine ? 'MATCHING' : 'LOSING'}
                    </div>
                </div>
            </div>

            {/* Streaming Chat Interface */}
            <div className="flex-1 min-h-0 bg-white dark:bg-gray-950/50 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col overflow-hidden relative shadow-inner">
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50/90 dark:from-gray-900/90 to-transparent z-10 pointer-events-none" />

                <div className="flex-grow overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center text-center mt-10 space-y-3 opacity-80">
                            <div className="text-gray-400 italic">
                                Coach is analyzing your driving... until you finish your lap
                            </div>
                            <div className="text-xs text-purple-400 font-mono animate-pulse">
                                {loadingMessages[loadingMessageIndex]}
                            </div>
                        </div>
                    )}
                    {messages.map((msg, index) => {
                        const isNewest = index === 0;
                        return (
                            <div
                                key={msg.id}
                                className={`flex gap-3 transition-all duration-500 ${isNewest ? 'animate-in slide-in-from-top-2' : ''}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.type === 'positive' ? 'bg-green-900/30 text-green-400' :
                                    msg.type === 'info' ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-800 text-gray-400'
                                    } ${isNewest ? 'ring-2 ring-white/20 scale-110' : ''}`}>
                                    <MessageSquare size={14} />
                                </div>
                                <div className="flex flex-col max-w-[85%]">
                                    <div className={`rounded-2xl rounded-tl-none px-4 py-2 text-sm transition-all ${msg.type === 'positive' ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-100 border border-green-200 dark:border-green-900/30' :
                                        msg.type === 'info' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-100 border border-blue-200 dark:border-blue-900/30' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
                                        } ${isNewest ? 'shadow-lg shadow-black/5 dark:shadow-black/50 font-medium scale-[1.02] origin-left' : ''}`}>
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
                                        {msg.isPredictive && (
                                            <>
                                                <span className="inline-flex items-center gap-1 text-teal-400 border-l border-gray-700 pl-2" title="Predictive">
                                                    <TrendingUp size={10} /> Predictive
                                                </span>
                                            </>
                                        )}

                                    </span>

                                    {/* Analysis Toggle */}
                                    {msg.analysis && (
                                        <details className="mt-2 group">
                                            <summary className="list-none text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1 select-none">
                                                <div className="w-0 h-0 border-l-4 border-l-transparent border-t-4 border-t-gray-500 border-r-4 border-r-transparent transform -rotate-90 group-open:rotate-0 transition-transform" />
                                                View Analysis
                                            </summary>
                                            <div className="mt-2 p-2 bg-gray-50 dark:bg-black/20 rounded border border-gray-200 dark:border-white/5 text-xs text-gray-800 dark:text-gray-200 font-mono leading-relaxed [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>h3]:font-bold [&>h3]:mt-2 [&>h3]:mb-1 [&>p]:mb-2 [&>strong]:text-gray-900 dark:[&>strong]:text-white">
                                                <ReactMarkdown>{msg.analysis}</ReactMarkdown>
                                            </div>
                                        </details>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};
