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
          systemPrompt: "You are an expert racing coach. Your job is to give short, punchy, and actionable advice to a racing driver based on telemetry data. Keep it under 20 words. Be encouraging but firm. Focus on speed, braking points, and racing line."
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

  const generateFeedback = useCallback(async (baseMessage: string, contextString: string) => {
    if (!sessionRef.current || status.state !== 'ready') {
      return baseMessage; // Fallback to original message
    }

    try {
      const prompt = `
Context: ${contextString}
Base Message: "${baseMessage}"
Task: Rewrite the base message to be more specific and coach-like based on the context. Keep it very short.
`;
      const response = await sessionRef.current.prompt(prompt);
      return response.trim();
    } catch (err) {
      console.error('Nano generation failed:', err);
      return baseMessage;
    }
  }, [status.state]);

  return {
    status,
    generateFeedback
  };
};
