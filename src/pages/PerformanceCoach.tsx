import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';

import { Activity, ThumbsUp, TrendingUp, MessageSquare, Brain, Zap, Settings, ShieldAlert, Volume2, FileText, Loader2 } from 'lucide-react';
import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';
import { useGeminiNano } from '../hooks/useGeminiNano';
import { useGeminiCloud } from '../hooks/useGeminiCloud';
import { useTTS } from '../hooks/useTTS';
import { useSignalQuality } from '../hooks/useSignalQuality';
import { useTrackLocation, type TrackPoint } from '../hooks/useTrackLocation';
import { useDrivingAnalysis } from '../hooks/useDrivingAnalysis';
import { parseCoachResponse } from '../utils/aiResponseParser';
import ReactMarkdown from 'react-markdown';
import { generateCoachReport } from '../services/reportGenerationService';

interface PerformanceCoachProps {
    currentFrame: TelemetryFrame | null;
    ghostFrame: TelemetryFrame | null;
    idealLap: LapData | null;
    currentIndex: number;
    laps: LapData[];
    trackPoints?: TrackPoint[];
    trackDetails?: string;
    gpsOnly?: boolean;
    videoFile?: File | null;
    videoOffset?: number;
}

interface CoachMessage {
    id: number;
    text: string;
    type: 'positive' | 'neutral' | 'info';
    timestamp: number;
    mode?: 'code' | 'nano' | 'flash' | 'pro';
    telemetryTime: number;
    generationTime?: number;
    analysis?: string;
}

type CoachMode = 'code' | 'nano' | 'flash' | 'pro';

export const PerformanceCoach: React.FC<PerformanceCoachProps> = ({ currentFrame, ghostFrame, currentIndex, laps, trackPoints = [], trackDetails = '', gpsOnly = false, videoFile, videoOffset = 0 }) => {
    const [messages, setMessages] = useState<CoachMessage[]>([]);
    const [mode, setMode] = useState<CoachMode>('nano');
    const [showSettings, setShowSettings] = useState(false);
    const lastMessageTimeRef = useRef<number>(0);
    const { status: nanoStatus, generateFeedback: generateNano } = useGeminiNano();
    const { status: cloudStatus, generateFeedback: generateCloud, setApiKey, generateAudio } = useGeminiCloud();
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

    // Report Gen State
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");



    // const { generateAudio } = useGeminiCloud(); // Removed: destructured at top level

    // We need to overwrite the previous handleGenerateReport to use the scoped generateAudio
    const handleGenerateReportScoped = async () => {
        setIsGeneratingReport(true);
        setGenerationStatus("Initializing...");
        try {
            // Load Track Map
            let trackMapBase64: string | null = null;
            try {
                const response = await fetch('/track_map.png');
                if (response.ok) {
                    const blob = await response.blob();
                    trackMapBase64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                    });
                }
            } catch (e) {
                console.warn("Could not load track map image", e);
            }

            await generateCoachReport({
                laps,
                currentFrame,
                trackDetails,
                videoFile,
                videoOffset,
                trackPoints: trackPoints?.map(p => ({ latitude: p.lat, longitude: p.long })),
                trackMapImage: trackMapBase64,
                generateFeedback: (m, c, i) => generateCloud(m as any, c, i),
                generateAudio: generateAudio,
                onStatusUpdate: setGenerationStatus
            });
        } catch (e) {
            console.error(e);
            setGenerationStatus("Failed: " + (e as Error).message);
            setTimeout(() => setIsGeneratingReport(false), 2000);
        } finally {
            // Don't close immediately on success so user sees "Complete"
            if (generationStatus !== "Complete!") {
                // setIsGeneratingReport(false); 
            } else {
                setTimeout(() => setIsGeneratingReport(false), 2000);
            }
        }
    };

    // Reset messages when restarting (index 0)
    useEffect(() => {
        if (currentIndex === 0) {
            setTimeout(() => {
                setMessages([]);
                lastMessageTimeRef.current = 0;
            }, 0);
        }
    }, [currentIndex]);



    // Trigger State Refs
    const deviationStartTimeRef = useRef<number | null>(null);
    const lastHillStateRef = useRef<'uphill' | 'downhill' | 'flat'>('flat');
    const lastCallTime = useRef<number>(0); // For global cooldown

    // Analysis Memo created only when frame changes
    const performanceStats = useMemo(() => {
        if (!currentFrame || !ghostFrame) return null;

        // Calculate deltas
        const speedDelta = currentFrame.speed - ghostFrame.speed; // Positive means faster than ghost

        // In GPS Only mode, we can only relax line matching criteria or ignore it?
        // Actually we can still calculate it from GPS if we had heading? 
        // But G-Force comes from GPSD Frame? 
        // GPSD "TPV" frame does not have G-Force, we calculate it or it is 0. 
        // In useRealtimeTelemetry, we set gForceLat/Long to 0. 
        // So "isGoodLine" will always be true (0 == 0) if ghost is also 0? 
        // Or valid if ghost has G-Force? 
        // Ghost is distinct. Ghost likely comes from a previous session (maybe Replay file?).
        // If Ghost has G-Force and Live has 0, delta is huge -> "Bad Line".
        // So if gpsOnly, we should ignore line matching based on G-Force.

        const speedMatch = Math.abs(speedDelta) < 5; // Within 5 km/h

        // GPS Only: Ignore G-Force matching
        const gLatMatch = gpsOnly ? true : Math.abs(currentFrame.gForceLat - ghostFrame.gForceLat) < 0.2;
        const gLongMatch = gpsOnly ? true : Math.abs(currentFrame.gForceLong - ghostFrame.gForceLong) < 0.2;

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
    }, [currentFrame, ghostFrame, gpsOnly]);

    // Helper function to generate heuristic messages
    const getCoachMessage = useCallback((perfStats: NonNullable<typeof performanceStats>): CoachMessage => {
        let baseText = "";
        let msgType: 'positive' | 'neutral' | 'info' = 'info';
        const now = Date.now();

        if (perfStats.isFaster) {
            if (perfStats.isNewBest) {
                baseText = "New Best.";
                msgType = 'positive';
            } else {
                const phrases = [
                    "Pace is good. Maintain.",
                    "Sectors green. Keep pushing.",
                    "Faster. Hold line.",
                    "Exit speed sufficient.",
                    "Sector fast.",
                    "Corner nailed.",
                    "Gap increasing."
                ];
                if (Math.random() > 0.8) {
                    baseText = phrases[Math.floor(Math.random() * phrases.length)];
                }
            }
        } else if (perfStats.isGoodSpeed && perfStats.isGoodLine) {
            const phrases = [
                "Line correct.",
                "Matching ideal lap.",
                "Inputs smooth.",
                "On target.",
                "Flow good.",
                "Consistent.",
            ];
            baseText = phrases[Math.floor(Math.random() * phrases.length)];
            msgType = 'neutral';
        } else if (perfStats.speedDelta < -10) {
            // Only give constructive feedback occasionally
            if (Math.random() > 0.6) {
                let phrases = [
                    "Lost some speed there, try to carry more momentum.",
                    "Losing time, push harder!"
                ];

                // Specific Feedback Logic (simplified for this example, assuming ghostFrame is available)
                if (ghostFrame) {
                    const throttleDelta = ghostFrame.throttle - currentFrame!.throttle;
                    const brakeDelta = currentFrame!.brake - ghostFrame.brake;
                    const isCornering = Math.abs(currentFrame!.gForceLat) > 0.5;
                    const isCoasting = currentFrame!.throttle < 5 && currentFrame!.brake < 5;
                    const gearMismatch = currentFrame!.gear !== ghostFrame.gear;
                    const steeringDelta = Math.abs(currentFrame!.steering) - Math.abs(ghostFrame.steering);
                    const brakePressureDelta = ghostFrame.brakePressure - currentFrame!.brakePressure;
                    const rpmDelta = ghostFrame.rpm - currentFrame!.rpm;

                    if (isCoasting && ghostFrame.throttle > 10) {
                        phrases = [
                            "Don't coast! Get back on power.",
                            "Too much hesitation between brake and throttle.",
                            "You're coasting, keep the momentum up.",
                            "Minimize the time off pedals.",
                            "No coasting allowed! Power or brakes.",
                            "You're floating. Commit to a pedal."
                        ];
                    } else if (gearMismatch && currentFrame!.gear > ghostFrame.gear) {
                        phrases = [
                            `Downshift! Gear ${ghostFrame.gear} recommended.`,
                            "Too high a gear for this corner.",
                            "Engine bogging? Drop a gear.",
                            "Use engine braking, downshift.",
                            `Recommended gear: ${ghostFrame.gear}.`,
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
                    } else if (brakePressureDelta > 10 && currentFrame!.brake > 0) {
                        phrases = [
                            "Press the brake harder!",
                            "More brake pressure required.",
                            "Maximize your braking efficiency.",
                            "Don't be afraid to stomp on the brakes.",
                            "More initial bite on the brakes.",
                            "Threshold braking! Push harder."
                        ];
                    } else if (rpmDelta > 1000 && currentFrame!.throttle > 90) {
                        phrases = [
                            "Shift up! You're hitting the limiter.",
                            "Late shift? Watch your RPMs.",
                            "Shift earlier.",
                            "Optimize your shift points.",
                            "Don't bounce off the limiter.",
                            "Shift now!"
                        ];
                    } else if (throttleDelta > 20) {
                        if (isCornering) {
                            phrases = [
                                "Power out of the corner sooner.",
                                "Unwind the wheel and get on gas.",
                                "Late on throttle.",
                                "Trust the rear grip on exit.",
                                "Squeeze the throttle earlier.",
                                "Don't wait, get on the power."
                            ];
                        } else {
                            phrases = [
                                "Get on the gas earlier!",
                                "Hesitating on throttle? Commit!",
                                "Full throttle required!",
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
                    } else if (isCornering && Math.abs(perfStats.speedDelta) > 15) {
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

        return {
            id: now,
            text: baseText,
            type: msgType,
            timestamp: now,
            telemetryTime: currentFrame!.time,
        };
    }, [currentFrame, ghostFrame]);

    // Message Generation Logic
    useEffect(() => {
        if (!performanceStats || !currentFrame || !drivingAnalysis) return;

        const now = Date.now();
        const timeSinceLastCall = now - lastCallTime.current;

        let shouldTrigger = false;
        let triggerReason = "";

        // A. Pace Deviation Trigger
        if (Math.abs(performanceStats.speedDelta) > 10) {
            if (!deviationStartTimeRef.current) {
                deviationStartTimeRef.current = now;
            } else if (now - deviationStartTimeRef.current > 3000) {
                shouldTrigger = true;
                triggerReason = "Pace Deviation";
            }
        } else {
            deviationStartTimeRef.current = null;
        }

        // B. Hill Trigger (Gradient Change)
        const currentGradient = drivingAnalysis.gradient ?? 0;
        let hillState: 'uphill' | 'downhill' | 'flat' = 'flat';
        if (currentGradient > 3) hillState = 'uphill';
        else if (currentGradient < -3) hillState = 'downhill';

        if (hillState !== lastHillStateRef.current) {
            shouldTrigger = true;
            triggerReason = `Terrain Change: ${hillState}`;
            lastHillStateRef.current = hillState;
        }

        // C. New Best Trigger
        if (performanceStats.isNewBest) {
            shouldTrigger = true;
            triggerReason = "New Best";
        }

        // Global Cooldown (8s)
        const COOLDOWN = 8000;

        if (shouldTrigger && timeSinceLastCall > COOLDOWN) {
            const heuristicMessage = getCoachMessage(performanceStats);

            // Context for AI models
            let contextString = `
Speed: ${currentFrame.speed.toFixed(0)} km/h
Delta: ${performanceStats.speedDelta.toFixed(1)} km/h
`;
            if (signalQuality.isGearActive && currentFrame.gear !== 255) contextString += `Gear: ${currentFrame.gear}\n`;
            if (signalQuality.isGForceActive) contextString += `Lat G: ${currentFrame.gForceLat.toFixed(2)}\n`;
            const throttleVal = currentFrame.throttle < 2 ? 0 : currentFrame.throttle;
            const brakeVal = currentFrame.brake < 2 ? 0 : currentFrame.brake;
            if (signalQuality.isThrottleActive) contextString += `Throttle: ${throttleVal.toFixed(0)}%\n`;
            if (signalQuality.isBrakeActive) contextString += `Brake: ${brakeVal.toFixed(0)}%\n`;

            if (trackLocation) contextString += `Location: ${trackLocation}\n`;

            if (drivingAnalysis.phase && drivingAnalysis.phase !== 'Straight') contextString += `Phase: ${drivingAnalysis.phase}\n`;
            contextString += `Grip Usage: ${drivingAnalysis.gripUsage}G\n`;
            if (drivingAnalysis.smoothnessScore < 70) contextString += `Smoothness: ${drivingAnalysis.smoothnessScore} (Rough)\n`;
            if (drivingAnalysis.gradient) contextString += `Gradient: ${drivingAnalysis.gradient}%\n`;
            if (drivingAnalysis.rpmBand === 'Over-rev') contextString += `RPM: ${currentFrame.rpm} (Over-revving!)\n`;

            if (trackDetails) contextString += `Track Info: ${trackDetails}\n`;

            contextString += `Status: ${performanceStats.isNewBest ? 'NEW BEST DETECTED' : performanceStats.isFaster ? 'GAINING TIME' : performanceStats.isGoodLine ? 'MATCHING PACE' : 'LOSING TIME'}\n`;
            contextString += `Directives: Use Catalyst vocabulary. If status is 'NEW BEST', say "New Best". Otherwise, give specific instruction like "Brake later".\n`;


            const generateAndAddMessage = async (text: string, msgType: 'positive' | 'neutral' | 'info', messageMode: CoachMode, genDuration?: number, explicitAnalysis?: string) => {
                const { directive, analysis } = parseCoachResponse(text);

                const newMessage: CoachMessage = {
                    id: now,
                    text: directive,
                    type: msgType,
                    timestamp: now,
                    mode: messageMode,
                    telemetryTime: currentFrame.time,
                    generationTime: genDuration,
                    analysis: explicitAnalysis || analysis || undefined
                };
                setMessages(prev => [newMessage, ...prev.slice(0, historyLength - 1)]);
                lastMessageTimeRef.current = now;
                if (isAudioEnabled) {
                    speak(directive); // Speak only the directive
                }
            };

            if (mode === 'code') {
                if (heuristicMessage.text) {
                    generateAndAddMessage(heuristicMessage.text, heuristicMessage.type, 'code');
                    lastCallTime.current = now;
                }
            }
            else if (mode === 'nano' && nanoStatus.state === 'ready') {
                (async () => {
                    const genStartTime = performance.now();
                    // Pass only context, no heuristic hint
                    const nanoInput = `Trigger: ${triggerReason}.\n${contextString}`;
                    const nanoText = await generateNano(nanoInput);
                    const genDuration = performance.now() - genStartTime;
                    if (nanoText) {
                        generateAndAddMessage(nanoText, heuristicMessage.type, 'nano', genDuration, nanoInput);
                    }
                })();
                lastCallTime.current = now;
            }
            else if ((mode === 'flash' || mode === 'pro') && cloudStatus.hasKey) {
                if (serializeRequests && cloudStatus.state === 'loading') {
                    return; // Prevent overlapping requests
                }
                (async () => {
                    const genStartTime = performance.now();
                    // Swapped arguments: model, context, (optional hint removed)
                    const cloudText = await generateCloud(mode, contextString);
                    const genDuration = performance.now() - genStartTime;
                    if (cloudText) {
                        generateAndAddMessage(cloudText, heuristicMessage.type, mode, genDuration);
                    }
                })();
                lastCallTime.current = now;
            }
        }

    }, [
        currentFrame,
        performanceStats,
        drivingAnalysis,
        mode, nanoStatus.state, cloudStatus.state, isAudioEnabled, speak, generateNano, generateCloud, signalQuality, trackLocation, historyLength, serializeRequests, cloudStatus.hasKey,
        getCoachMessage, trackDetails
    ]);

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
        <div className="flex-grow bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-4 h-full overflow-hidden relative">
            {/* Settings Modal */}
            {showSettings && (
                <div className="absolute inset-0 z-50 bg-white/95 dark:bg-gray-900/95 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
                        <div className="flex items-center gap-2 mb-4 text-purple-600 dark:text-purple-400">
                            <Settings size={20} />
                            <h3 className="font-bold text-lg">Coach Settings</h3>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 ml-1">Gemini API Key</label>
                                <input
                                    type="password"
                                    value={settingsKey}
                                    onChange={(e) => setSettingsKey(e.target.value)}
                                    placeholder="Enter your API Key"
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:border-purple-500 placeholder-gray-500 dark:placeholder-gray-600 font-mono"
                                />
                                <p className="text-[10px] text-gray-500 mt-2">
                                    Required for Flash and Pro modes. Your key is stored locally in your browser.
                                </p>
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                                <label className="flex items-center gap-2 cursor-pointer mb-2">
                                    <input
                                        type="checkbox"
                                        checked={serializeRequests}
                                        onChange={(e) => setSerializeRequests(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500 bg-white dark:bg-gray-900"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Serialize Requests</span>
                                </label>
                                <p className="text-[10px] text-gray-500 ml-6">
                                    Wait for the previous AI response before sending a new one. Reduces API usage and errors.
                                </p>
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 ml-1">Message History</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={historyLength}
                                    onChange={(e) => setHistoryLength(Math.max(1, parseInt(e.target.value) || 50))}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:border-purple-500 placeholder-gray-500 dark:placeholder-gray-600 font-mono"
                                />
                                <p className="text-[10px] text-gray-500 mt-2">
                                    Number of previous messages to keep visible.
                                </p>
                            </div>

                            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700 mt-2">
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="flex-1 px-4 py-2 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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

            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Activity className="text-purple-600 dark:text-purple-500" size={20} />
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">PERFORMANCE COACH</h2>
                </div>

                <div className="flex items-center gap-4">
                    {/* Intelligence Group */}
                    <div className="flex items-center gap-2">
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
                    <div className="flex items-center gap-2 pl-4 border-l border-gray-200 dark:border-gray-700">
                        <Volume2 size={16} className="text-blue-500 dark:text-blue-400" />
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
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${isAudioEnabled && audioProvider === 'gemini-flash'
                                    ? 'bg-indigo-600 text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                                onClick={() => { setIsAudioEnabled(true); setAudioProvider('gemini-flash'); }}
                                title="Gemini 2.5 Flash Audio"
                            >
                                FLASH
                            </button>
                            <button
                                className={`px-3 py-1 rounded-md text-[10px] uppercase font-bold transition-all ${isAudioEnabled && audioProvider === 'gemini-pro'
                                    ? 'bg-purple-600 text-white shadow-lg'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                                onClick={() => { setIsAudioEnabled(true); setAudioProvider('gemini-pro'); }}
                                title="Gemini 1.5 Pro Audio"
                            >
                                PRO
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleGenerateReportScoped}
                        disabled={isGeneratingReport}
                        className={`p-1.5 rounded-lg transition-all flex items-center gap-2 ${isGeneratingReport ? 'bg-purple-100 text-purple-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                        title="Generate Coach Report"
                    >
                        {isGeneratingReport ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                        {isGeneratingReport && <span className="text-[10px] font-bold hidden sm:inline">{generationStatus}</span>}
                    </button>

                    <button
                        onClick={toggleSettings}
                        className={`p-1.5 rounded-lg transition-colors ${showSettings || cloudStatus.hasKey ? 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800' : 'text-yellow-500 animate-pulse bg-yellow-500/10'}`}
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
                    <span>Missing API Key for {mode.toUpperCase()} mode. Please add it in settings.</span>
                </div>
            )}

            {/* HUD Section */}
            <div className="grid grid-cols-2 gap-4 shrink-0">
                {/* Speed Comparison */}
                <div className="bg-white dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Speed Delta</div>
                    <div className={`text-3xl font-mono font-bold ${(performanceStats?.speedDelta || 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                        {performanceStats?.speedDelta ? (performanceStats.speedDelta > 0 ? '+' : '') + performanceStats.speedDelta.toFixed(1) : '0.0'} <span className="text-sm text-gray-500">km/h</span>
                    </div>
                </div>

                {/* Status Icon */}
                <div className="bg-white dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center justify-center text-center">
                    {performanceStats?.isGoodSpeed && performanceStats?.isGoodLine ? (
                        <ThumbsUp className="text-green-500" size={32} />
                    ) : performanceStats?.isFaster ? (
                        <TrendingUp className="text-blue-500" size={32} />
                    ) : (
                        <Activity className="text-gray-400 dark:text-gray-600" size={32} />
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {performanceStats?.isFaster ? 'GAINING' : performanceStats?.isGoodLine ? 'MATCHING' : 'LOSING'}
                    </div>
                </div>
            </div>

            {/* Streaming Chat Interface */}
            <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-950/50 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col overflow-hidden relative">
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-100/90 dark:from-gray-900/90 to-transparent z-10 pointer-events-none" />

                <div className="flex-grow overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent">
                    {messages.length === 0 && (
                        <div className="text-center text-gray-400 dark:text-gray-600 text-sm mt-10 italic">
                            Coach is analyzing your driving...
                        </div>
                    )}
                    {messages.map((msg, index) => {
                        const isNewest = index === 0;
                        return (
                            <div
                                key={msg.id}
                                className={`flex gap-3 transition-all duration-500 ${isNewest ? 'animate-in slide-in-from-top-2' : ''}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.type === 'positive' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                                    msg.type === 'info' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                                    } ${isNewest ? 'ring-2 ring-white/20 scale-110' : ''}`}>
                                    <MessageSquare size={14} />
                                </div>
                                <div className="flex flex-col max-w-[85%]">
                                    <div className={`rounded-2xl rounded-tl-none px-4 py-2 text-sm transition-all ${msg.type === 'positive' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-100 border border-green-200 dark:border-green-900/30' :
                                        msg.type === 'info' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-100 border border-blue-200 dark:border-blue-900/30' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
                                        } ${isNewest ? 'shadow-lg shadow-black/5 dark:shadow-black/50 font-medium scale-[1.02] origin-left' : ''}`}>
                                        {msg.text}
                                    </div>
                                    <span className="text-[10px] text-gray-500 dark:text-gray-600 mt-1 ml-1 flex items-center gap-2 flex-wrap">
                                        <span>
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        <span className="text-gray-400 dark:text-gray-500 border-l border-gray-300 dark:border-gray-700 pl-2">
                                            T+{msg.telemetryTime.toFixed(1)}s
                                        </span>

                                        {msg.mode === 'nano' && (
                                            <>
                                                <span className="inline-flex items-center gap-1 text-indigo-500 dark:text-indigo-400 border-l border-gray-300 dark:border-gray-700 pl-2" title="Refined by Nano">
                                                    <Brain size={10} /> Nano
                                                </span>
                                                {msg.generationTime && <span className="text-gray-400 dark:text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                            </>
                                        )}
                                        {msg.mode === 'flash' && (
                                            <>
                                                <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-500 border-l border-gray-300 dark:border-gray-700 pl-2" title="Refined by Flash">
                                                    <Zap size={10} /> Flash
                                                </span>
                                                {msg.generationTime && <span className="text-gray-400 dark:text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                            </>
                                        )}
                                        {msg.mode === 'pro' && (
                                            <>
                                                <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 border-l border-gray-300 dark:border-gray-700 pl-2" title="Refined by Pro">
                                                    <Settings size={10} /> Pro
                                                </span>
                                                {msg.generationTime && <span className="text-gray-500 text-[10px] ml-1">Gen: {msg.generationTime.toFixed(0)}ms</span>}
                                            </>
                                        )}
                                    </span>

                                    {/* Analysis Toggle */}
                                    {msg.analysis && (
                                        <details className="mt-2 group">
                                            <summary className="list-none text-[10px] text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex items-center gap-1 select-none">
                                                <div className="w-0 h-0 border-l-4 border-l-transparent border-t-4 border-t-gray-500 border-r-4 border-r-transparent transform -rotate-90 group-open:rotate-0 transition-transform" />
                                                View Analysis
                                            </summary>
                                            <div className="mt-2 p-2 bg-gray-100 dark:bg-black/20 rounded border border-gray-200 dark:border-white/5 text-xs text-gray-600 dark:text-gray-400 font-mono leading-relaxed [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>h3]:font-bold [&>h3]:mt-2 [&>h3]:mb-1 [&>p]:mb-2 [&>strong]:text-gray-700 dark:[&>strong]:text-gray-300">
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
