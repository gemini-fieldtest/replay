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
          systemPrompt: "You are an expert racing coach. Your job is to give short, punchy, and actionable advice. Use specific vocabulary: 'Brake later', 'Turn in earlier', 'Track out further', 'Apex late', 'Carry speed'. Do NOT give praise unless it is a 'New Best'. Focus on physics and inputs. Do NOT mention the 'ghost' or 'ideal lap'."
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

  const generateFeedback = useCallback(async (contextString: string, baseMessage?: string) => {
    if (!sessionRef.current || status.state !== 'ready') {
      return baseMessage || '';
    }

    try {
      let prompt;
      if (baseMessage) {
        // Rewrite mode (legacy/fallback)
        prompt = `
Context: ${contextString}
Base Message: "${baseMessage}"
Task: Rewrite the base message to be strict and actionable. Remove any praise or fluff. Keep it very short.
`;
      } else {
        // Independent generation mode
        prompt = `
Telemetry Context:
${contextString}

Task: You are the race engineer. Analyze the telemetry above. Identify the single most important area for improvement (speed, braking, throttle, line).
Output: A single, short, punchy sentence of advice. Do not be generic. Be direct. Max 15 words. DO NOT PRAISE.
Example: "Brake later and trail off to rotate the car."
Advice:
`;
      }
      
      const response = await sessionRef.current.prompt(prompt);
      return response.trim();
    } catch (err) {
      console.error('Nano generation failed:', err);
      return baseMessage || '';
    }
  }, [status.state]);

  return {
    status,
    generateFeedback
  };
};
