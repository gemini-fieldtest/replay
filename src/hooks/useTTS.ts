import { useState, useEffect, useRef, useCallback } from 'react';

export type TTSProvider = 'browser' | 'google';

interface TTSOptions {
  apiKey?: string;
}

export const useTTS = (options: TTSOptions = {}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [provider, setProvider] = useState<TTSProvider>('browser');
  const [voice, setVoice] = useState<string>('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Audio context for Google TTS decoding
  const audioContextRef = useRef<AudioContext | null>(null);

  // Load browser voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (!voice) {
          // Default to first English voice
          const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
          if(defaultVoice) setVoice(defaultVoice.name);
      }
    };

    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    
    return () => {
        window.speechSynthesis.cancel();
    }
  }, [voice]);

  const speak = useCallback(async (text: string) => {
    if (!isEnabled) return;
    
    // Cancel any current speech
    window.speechSynthesis.cancel();
    if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
    }

    setIsSpeaking(true);

    try {
        if (provider === 'browser') {
            const utterance = new SpeechSynthesisUtterance(text);
            const selectedVoice = availableVoices.find(v => v.name === voice);
            if (selectedVoice) utterance.voice = selectedVoice;
            
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);
            
            window.speechSynthesis.speak(utterance);
        } else if (provider === 'google' && options.apiKey) {
            // Google Cloud TTS
            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${options.apiKey}`, {
                method: 'POST',
                body: JSON.stringify({
                    input: { text },
                    voice: { languageCode: 'en-US', name: 'en-US-Journey-F' }, // Using a nice Journey voice by default for now
                    audioConfig: { audioEncoding: 'MP3' },
                }),
            });

            if (!response.ok) {
                throw new Error('Google TTS request failed');
            }

            const data = await response.json();
            const audioData = data.audioContent;
            
            // Decode and play
            const binaryString = window.atob(audioData);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            audioContextRef.current = audioContext;
            
            const buffer = await audioContext.decodeAudioData(bytes.buffer);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            
            source.onended = () => {
                setIsSpeaking(false);
                audioContext.close();
                audioContextRef.current = null;
            };
            
            source.start(0);
        }
    } catch (error) {
        console.error("TTS Error:", error);
        setIsSpeaking(false);
    }
  }, [isEnabled, provider, voice, availableVoices, options.apiKey]);

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  return {
    isEnabled,
    setIsEnabled,
    provider,
    setProvider,
    voice, 
    setVoice,
    availableVoices,
    speak,
    cancel,
    isSpeaking
  };
};
