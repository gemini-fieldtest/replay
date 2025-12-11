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
  
  const sessionRef = useRef<AILanguageModel | null>(null);

  useEffect(() => {
    const initNano = async () => {
      try {
        // 1. Check for API existence (Global LanguageModel)
        if (!window.LanguageModel) {
            // Fallback check for window.ai.languageModel just in case
            if (window.ai?.languageModel) {
                console.log('[useGeminiNano] Found window.ai.languageModel but not window.LanguageModel. Using alias.');
                // Handling legacy/alias case
                window.LanguageModel = window.ai.languageModel; 
            } else {
                const msg = 'window.LanguageModel not found (Chrome Canary + Flags required)';
                console.warn(`[useGeminiNano] ${msg}`);
                setStatus({ isAvailable: false, state: 'unavailable', error: msg });
                return;
            }
        }

        // 2. Check Availability
        let availability = 'no';
        try {
            availability = await window.LanguageModel!.availability();
        } catch (_e) {
            console.debug('availability() check failed, trying capabilities()', _e);
            // Fallback to capabilities() if availability() missing (API flux)
            if ('capabilities' in window.LanguageModel!) {
               const caps = await window.LanguageModel!.capabilities();
               availability = caps.available;
            }
        }

        console.log(`[useGeminiNano] Model availability: ${availability}`);

        if (availability === 'no') {
           setStatus({ isAvailable: false, state: 'unavailable', error: 'Model availability is "no"' });
           return;
        }

        // 3. Create Session
        const session = await window.LanguageModel!.create({
          initialPrompts: [{
              role: 'system',
              content: `You are a Race Spotter.
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
          }]
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
        // New API might use .destroy(), check docs or assume safe to leave for now
        // Docs (Pos 15) say `session.destroy()` is likely correct for aborting/cleanup
        if (typeof sessionRef.current.destroy === 'function') {
            sessionRef.current.destroy();
        }
      }
    };
  }, []);

  const generateFeedback = useCallback(async (contextString: string | object) => {
    if (!sessionRef.current || status.state !== 'ready') {
      console.warn('[useGeminiNano] Session not ready or missing');
      return '';
    }

    try {
      console.log('[useGeminiNano] Generating content for context:', contextString);
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


