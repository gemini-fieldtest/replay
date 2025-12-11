import { useState, useEffect, useRef, useCallback } from 'react';

export interface NanoStatus {
  isAvailable: boolean;
  state: 'initializing' | 'ready' | 'error' | 'unavailable';
  error?: string;
}

export const useGeminiNano = () => {
  const [status, setStatus] = useState<NanoStatus>({
    isAvailable: false,
    state: 'initializing'
  });
  
  const sessionRef = useRef<AITextSession | null>(null);

  useEffect(() => {
    const initNano = async () => {
      try {
        if (!window.ai) {
          setStatus({ isAvailable: false, state: 'unavailable', error: 'window.ai not found' });
          return;
        }

        const canCreate = await window.ai.canCreateTextSession();
        
        if (canCreate === 'no') {
          setStatus({ isAvailable: false, state: 'unavailable' });
          return;
        }

        // Initialize session with a racing coach persona
        const session = await window.ai.createTextSession({
          systemPrompt: `You are a Race Spotter.
Check the "flags" in the input JSON. Priority is Top to Bottom.

PRIORITY 1: SAFETY
- If safety_status is "UNSTABLE" -> Output: "Smooth it out! Reset."

PRIORITY 2: CRITICAL ERRORS
- If error_type is "LATE_BRAKE_T9" -> Output: "BRAKE! Crest approaching!"
- If error_type is "COASTING_DETECTED" -> Output: "Don't coast. Gas or Brake."
- If driver_state is "PANIC" -> Output: "Smooth inputs."

PRIORITY 3: PACE
- If opportunity is "UNDER_DRIVING_T5" -> Output: "Trust the compression. Full throttle."
- If tire_usage is "LOW" -> Output: "Use more tire. Lean on it."
- If flags are clean and delta is Green -> Output: "Great pace."

Input JSON:`
        });

        sessionRef.current = session;
        setStatus({ isAvailable: true, state: 'ready' });

      } catch (err: unknown) {
        console.error('Failed to initialize Gemini Nano:', err);
        setStatus({ 
          isAvailable: false, 
          state: 'error', 
          error: (err as Error).message || 'Unknown error initializing Nano' 
        });
      }
    };

    initNano();

    return () => {
      if (sessionRef.current) {
        sessionRef.current.destroy();
      }
    };
  }, []);

  const generateFeedback = useCallback(async (contextString: string | object) => {
    if (!sessionRef.current || status.state !== 'ready') {
      return '';
    }

    try {
      let prompt;
      if (typeof contextString === 'object') {
          // New Middleware Mode
          prompt = JSON.stringify(contextString, null, 2);
      } else {
        // Independent mode (fallback)
        prompt = `
Telemetry Context:
${contextString}

Task: Analyze telemetry. Output single short sentence of advice. Max 15 words.
Advice:
`;
      }
      
      const response = await sessionRef.current.prompt(prompt);
      return response.trim();
    } catch (err) {
      console.error('Nano generation failed:', err);
      return '';
    }
  }, [status.state]);

  return {
    status,
    generateFeedback
  };
};


