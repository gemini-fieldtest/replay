import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality } from '@google/genai';

export type TTSProvider = 'browser' | 'google' | 'gemini-flash' | 'gemini-pro';

interface TTSOptions {
  apiKey?: string;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

interface TTSOptions {
  apiKey?: string;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export const useTTS = (options: TTSOptions = {}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [provider, setProvider] = useState<TTSProvider>('browser');
  const [voice, setVoice] = useState<string>('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Audio context for decoding
  const audioContextRef = useRef<AudioContext | null>(null);
  const isFetchingRef = useRef(false);

  // Load browser voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (!voice) {
        // Default to first English voice
        const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        if (defaultVoice) setVoice(defaultVoice.name);
      }
    };

    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();

    return () => {
      window.speechSynthesis.cancel();
    }
  }, [voice]);

  const apiKey = options.apiKey || import.meta.env.VITE_GEMINI_API_KEY || '';

  const speak = useCallback(async (text: string, speechOptions?: { rate?: number; pitch?: number; volume?: number }) => {
    console.log('[useTTS] speak called', { text, provider, isEnabled, hasApiKey: !!apiKey });
    if (!isEnabled) {
      console.warn('[useTTS] TTS is not enabled');
      return;
    }

    // Check if we are already fetching (serialization)
    if (isFetchingRef.current) {
      console.warn('[useTTS] Already fetching audio, ignoring request:', text);
      return;
    }

    // Only cancel if we are NOT fetching (i.e. we are playing).
    // If we are playing, the user might want to override with a new blocked request...
    // But the requirement is "only send 1 request ... until we get response back".
    // So if we are playing, fetching is false, so we CAN start fetching.
    // And when we start fetching, we should probably stop the current playback?
    // Standard TTS behavior is to stop previous.

    // Cancel any current speech
    window.speechSynthesis.cancel();
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsSpeaking(true);
    isFetchingRef.current = true; // Lock until playback starts

    try {
      if (provider === 'browser') {
        const utterance = new SpeechSynthesisUtterance(text);
        const selectedVoice = availableVoices.find(v => v.name === voice);
        if (selectedVoice) utterance.voice = selectedVoice;

        // Apply Dynamic Options
        if (speechOptions?.rate) utterance.rate = speechOptions.rate;
        if (speechOptions?.pitch) utterance.pitch = speechOptions.pitch;
        if (speechOptions?.volume) utterance.volume = speechOptions.volume;

        utterance.onend = () => { setIsSpeaking(false); isFetchingRef.current = false; };
        utterance.onerror = () => { setIsSpeaking(false); isFetchingRef.current = false; };

        window.speechSynthesis.speak(utterance);
        isFetchingRef.current = false; // Browser TTS is sync in dispatch
      } else if (provider === 'google' && apiKey) {
        // Google Cloud TTS (Legacy REST API)
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
          method: 'POST',
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: 'en-US', name: 'en-US-Journey-F' },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: speechOptions?.rate || 1.0,
              pitch: speechOptions?.pitch ? (speechOptions.pitch - 1) * 20 : 0,
            },
          }),
        });

        if (!response.ok) {
          throw new Error('Google TTS request failed');
        }

        const data = await response.json();
        const audioData = data.audioContent;

        // Decode and play
        const binaryString = window.atob(audioData);
        isFetchingRef.current = false; // Unlock before playing
        await playAudioData(binaryString, audioContextRef, () => setIsSpeaking(false));

      } else if (provider === 'gemini-flash') {
        if (!apiKey) {
          console.error('[useTTS] Gemini provider selected but no API key available');
          setIsSpeaking(false);
          isFetchingRef.current = false;
          return;
        }
        console.log('[useTTS] Starting Gemini Flash (Live API)');

        const client = new GoogleGenAI({ apiKey });
        const model = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

        const config = {
          responseModalities: [Modality.AUDIO],
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Zephyr',
              }
            }
          },
          systemInstruction: {
            parts: [{
              text: `You are a professional Voice Actor and Race Engineer.
  Your ONLY job is to speak the user's text EXACTLY as written.
  DO NOT reply to the text. DO NOT answer questions. DO NOT say "Okay" or "Here is the audio".
  Tone Instructions:
  - If the text implies DANGER or URGENCY (e.g., "Brake!", "Traffic"), speak with high energy and urgency.
  - If the text is POSITIVE (e.g., "Great job", "New Best"), speak with excitement and encouragement.
  - Otherwise, speak calmly and clearly.
  Just read the text.`
            }]
          },
          contextWindowCompression: {
            triggerTokens: '25600',
            slidingWindow: { targetTokens: '12800' },
          },
        };

        const audioParts: string[] = [];
        let audioMimeType = '';

        const session = await client.live.connect({
          model,
          config,
          callbacks: {
            onopen: () => {
              console.log('[useTTS] Gemini Session Opened');
            },
            onmessage: (message: LiveServerMessage) => {
              // ... same logic usually, maybe omit logs for brevity in this full replacement if I can, but I'll keeping it safe
              // Actually I can't rely on existing code if I replace deeply.
              // I will try to match what was there.
              console.log('[useTTS] Received message', message);
              if (message.serverContent?.modelTurn?.parts) {
                const part = message.serverContent?.modelTurn?.parts?.[0];
                if (part?.inlineData) {
                  audioParts.push(part.inlineData.data ?? '');
                  if (!audioMimeType && part.inlineData.mimeType) {
                    audioMimeType = part.inlineData.mimeType;
                  }
                }
              }

              if (message.serverContent?.turnComplete) {
                // Done
                if (audioParts.length > 0) {
                  const wavBuffer = convertToWav(audioParts, audioMimeType);
                  isFetchingRef.current = false; // Unlock before playing
                  playAudioBuffer(wavBuffer, audioContextRef, () => setIsSpeaking(false));
                } else {
                  setIsSpeaking(false);
                  isFetchingRef.current = false;
                }
                session.close();
              }
            },
            onerror: (e) => {
              console.error('Gemini Session Error:', e);
              setIsSpeaking(false);
              session.close();
              isFetchingRef.current = false;
            },
            onclose: (e) => {
              console.log('[useTTS] Gemini Session Closed', e);
            }
          }
        });

        console.log('[useTTS] Sending client content', text);

        // Safety Timeout
        setTimeout(() => {
          if (isFetchingRef.current) {
            console.warn('[useTTS] Timeout waiting for Gemini response. Resetting lock.');
            isFetchingRef.current = false;
            session.close();
            setIsSpeaking(false);
          }
        }, 30000);

        try {
          await session.sendClientContent({
            turns: [text]
          });
          console.log('[useTTS] Client content sent successfully');
        } catch (e) {
          console.error('[useTTS] Failed to send client content:', e);
          isFetchingRef.current = false;
        }

      } else if (provider === 'gemini-pro') {
        if (!apiKey) {
          console.error('[useTTS] Gemini provider selected but no API key available');
          setIsSpeaking(false);
          isFetchingRef.current = false;
          return;
        }
        console.log('[useTTS] Starting Gemini Pro (GenerateContent API)');

        // Pro uses generateContentStream and likely v1alpha
        const client = new GoogleGenAI({
          apiKey,
          httpOptions: { apiVersion: 'v1alpha' }
        });

        const model = 'models/gemini-2.5-pro-preview-tts';

        const config = {
          temperature: 1,
          responseModalities: [Modality.AUDIO], // Or ['audio'] string, SDK enum is safer if compatible
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Fenrir',
              }
            }
          },
        };

        // Safety Timeout for Pro
        const timeoutId = setTimeout(() => {
          if (isFetchingRef.current) {
            console.warn('[useTTS] Timeout waiting for Gemini Pro response.');
            isFetchingRef.current = false;
            setIsSpeaking(false);
          }
        }, 30000);

        try {
          const response = await client.models.generateContentStream({
            model,
            config,
            contents: [{
              role: 'user',
              parts: [{ text: `Say exactly this: ${text}` }] // Simple prompting
            }],
          });

          const audioParts: string[] = [];
          let audioMimeType = '';

          for await (const chunk of response) {
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              audioParts.push(inlineData.data || '');
              if (!audioMimeType && inlineData.mimeType) {
                audioMimeType = inlineData.mimeType;
              }
            }
          }

          clearTimeout(timeoutId);

          if (audioParts.length > 0) {
            // Pro snippet used Buffer.from(base64) and concat.
            // convertToWav does logic for multiple chunks.
            // Note: Pro chunks are likely PCM without header? 
            // Snippet said "convertToWav" inside loop IF header needed?
            // Wait, the snippet had a convertToWav that created a header for EACH chunk.
            // If the stream returns full valid audio files in pieces, concatting them might not work if they have headers.
            // But usually Google TTS stream returns PCM chunks.
            // If inlineData.mimeType is 'audio/pcm; rate=24000', then it's PCM.
            // convertToWav handles adding ONE header to the TOTAL PCM.
            // So accumulating all parts into audioParts and calling convertToWav at the end should be correct.

            const wavBuffer = convertToWav(audioParts, audioMimeType || 'audio/pcm; rate=24000');
            isFetchingRef.current = false;
            playAudioBuffer(wavBuffer, audioContextRef, () => setIsSpeaking(false));
          } else {
            isFetchingRef.current = false;
            setIsSpeaking(false);
          }

        } catch (e) {
          console.error('[useTTS] Gemini Pro generation failed', e);
          isFetchingRef.current = false;
          setIsSpeaking(false);
        }
      }

      // Note: we can't clear timeout here easily because onmessage is where we end.
      // But we can store it in a ref or just let it race (if we finish early, we manually check in message?).
      // Actually, simple way: attach timeout clearing to the session closing logic or success.
      // Let's rely on isFetchingRef. If onmessage finishes, it sets isFetchingRef = false. 
      // Then the timeout callback sees it's false and does nothing. 
      // Perfect.
    } catch (error) {
      console.error("TTS Error:", error);
      setIsSpeaking(false);
      isFetchingRef.current = false;
    }
  }, [isEnabled, provider, voice, availableVoices, apiKey]);

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

/* --- Helpers --- */

async function playAudioData(binaryString: string, audioContextRef: React.MutableRefObject<AudioContext | null>, onEnded: () => void) {
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  await playAudioBuffer(bytes, audioContextRef, onEnded);
}

async function playAudioBuffer(bytes: Uint8Array, audioContextRef: React.MutableRefObject<AudioContext | null>, onEnded: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextClass();
  audioContextRef.current = audioContext;

  try {
    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer); // slice to copy if needed, though decodeAudioData detaches
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    source.onended = () => {
      onEnded();
      audioContext.close();
      audioContextRef.current = null;
    };

    source.start(0);
  } catch (e) {
    console.error("Audio Decode Error:", e);
    onEnded();
    audioContext.close();
  }
}


function parseMimeType(mimeType: string) {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options: WavConversionOptions = {
    numChannels: 1,
    sampleRate: 24000, // Default for Gemini
    bitsPerSample: 16,
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options;
}

function createWavHeader(dataLength: number, options: WavConversionOptions) {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');                      // ChunkID
  view.setUint32(4, 36 + dataLength, true);     // ChunkSize (little endian)
  writeString(8, 'WAVE');                      // Format
  writeString(12, 'fmt ');                     // Subchunk1ID
  view.setUint32(16, 16, true);                 // Subchunk1Size (PCM)
  view.setUint16(20, 1, true);                  // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);        // NumChannels
  view.setUint32(24, sampleRate, true);         // SampleRate
  view.setUint32(28, byteRate, true);           // ByteRate
  view.setUint16(32, blockAlign, true);         // BlockAlign
  view.setUint16(34, bitsPerSample, true);      // BitsPerSample
  writeString(36, 'data');                     // Subchunk2ID
  view.setUint32(40, dataLength, true);         // Subchunk2Size

  return new Uint8Array(buffer);
}

function convertToWav(rawDataChunks: string[], mimeType: string) {
  const options = parseMimeType(mimeType);

  // Convert chunks
  const buffers = rawDataChunks.map(chunk => {
    const binaryString = window.atob(chunk);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  });

  const dataLength = buffers.reduce((a, b) => a + b.length, 0);
  const wavHeader = createWavHeader(dataLength, options);

  // Concat
  const wavBuffer = new Uint8Array(wavHeader.length + dataLength);
  wavBuffer.set(wavHeader, 0);

  let offset = wavHeader.length;
  for (const b of buffers) {
    wavBuffer.set(b, offset);
    offset += b.length;
  }

  return wavBuffer;
}
