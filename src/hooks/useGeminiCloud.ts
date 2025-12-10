import { useState, useCallback } from 'react';

export type CloudModel = 'flash' | 'pro';

interface CloudStatus {
  state: 'idle' | 'loading' | 'error' | 'success';
  error?: string;
  hasKey: boolean;
}

export const useGeminiCloud = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  const [status, setStatus] = useState<CloudStatus>({
    state: 'idle',
    hasKey: !!apiKey
  });

  const generateFeedback = useCallback(async (model: CloudModel, baseMessage: string, contextString: string) => {
    if (!apiKey) {
      setStatus({ state: 'error', hasKey: false, error: 'API Key missing' });
      return baseMessage;
    }

    setStatus(prev => ({ ...prev, state: 'loading', error: undefined }));

    try {
      const modelName = model === 'pro' ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
      const prompt = `
Context: ${contextString}
Base Message: "${baseMessage}"
Task: You are a professional racing engineer. Rewrite the base message to be concise, technical, and actionable based on the context. Keep it under 25 words. Do NOT use emojis.
`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) throw new Error('No content in response');

      setStatus(prev => ({ ...prev, state: 'success' }));
      return text.trim();

    } catch (err: unknown) {
      console.error('Gemini Cloud generation failed:', err);
      setStatus({ state: 'error', hasKey: true, error: (err as Error).message });
      return baseMessage;
    }
  }, [apiKey]);

  return {
    status,
    generateFeedback
  };
};
