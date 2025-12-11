import { useState, useCallback } from 'react';

export type CloudModel = 'flash' | 'pro';

interface CloudStatus {
  state: 'idle' | 'loading' | 'error' | 'success';
  error?: string;
  hasKey: boolean;
}

export const useGeminiCloud = () => {
  const [apiKey, setAutoApiKey] = useState<string | null>(() => {
      // Prioritize Local Storage
      return localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || null;
  });

  const [status, setStatus] = useState<CloudStatus>({
    state: 'idle',
    hasKey: !!apiKey
  });

  // Update status when key changes
  const setApiKey = useCallback((key: string) => {
      if (key) {
          localStorage.setItem('gemini_api_key', key);
          setAutoApiKey(key);
          setStatus(prev => ({ ...prev, hasKey: true }));
      } else {
          localStorage.removeItem('gemini_api_key');
          setAutoApiKey(null);
          setStatus(prev => ({ ...prev, hasKey: false }));
      }
  }, []);

  const generateFeedback = useCallback(async (model: CloudModel, baseMessage: string, contextString: string) => {
    if (!apiKey) {
      setStatus({ state: 'error', hasKey: false, error: 'API Key missing' });
      return baseMessage;
    }

    setStatus(prev => ({ ...prev, state: 'loading', error: undefined }));

    try {
      const modelName = model === 'pro' ? 'gemini-3-pro-preview' : 'gemini-2.0-flash-exp';
      const prompt = `
Context: ${contextString}
Base Message: "${baseMessage}"
Task: You are a professional racing engineer. Rewrite the base message to be concise, technical, and actionable. Use specific vocabulary: 'Brake later', 'Turn in earlier', 'Track out further', 'Apex late'. Do NOT use emojis. Do NOT include praise unless explicitly stated in Context as 'New Best'. Do NOT mention the 'ghost'.
`;

      const requestBody: any = {
        contents: [{ parts: [{ text: prompt }] }]
      };

      if (model === 'pro') {
          requestBody.generationConfig = {
              thinkingConfig: {
                  thinkingLevel: 'HIGH'
              }
          };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1alpha/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
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
    generateFeedback,
    setApiKey
  };
};
