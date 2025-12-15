import { useState, useCallback } from "react";
import { GoogleGenAI, Modality } from '@google/genai';
import { convertToWav } from '../utils/audioUtils';

export type CloudModel = "flash" | "pro";

interface CloudStatus {
  state: "idle" | "loading" | "error" | "success";
  error?: string;
  hasKey: boolean;
}

export const useGeminiCloud = () => {
  const [apiKey, setAutoApiKey] = useState<string | null>(() => {
    // Prioritize Local Storage
    return localStorage.getItem("gemini_api_key") || null;
  });

  const [status, setStatus] = useState<CloudStatus>({
    state: "idle",
    hasKey: !!apiKey,
  });

  // Update status when key changes
  const setApiKey = useCallback((key: string) => {
    if (key) {
      localStorage.setItem("gemini_api_key", key);
      setAutoApiKey(key);
      setStatus((prev) => ({ ...prev, hasKey: true }));
    } else {
      localStorage.removeItem("gemini_api_key");
      setAutoApiKey(null);
      setStatus((prev) => ({ ...prev, hasKey: false }));
    }
  }, []);

  const generateFeedback = useCallback(
    async (model: CloudModel, contextString: string, images?: string[]) => {
      if (!apiKey) {
        setStatus({ state: "error", hasKey: false, error: "API Key missing" });
        return "";
      }


      setStatus((prev) => ({ ...prev, state: "loading", error: undefined }));

      try {
        const modelName =
          model === "pro" ? "gemini-3-pro-preview" : "fiercefalcon";
        const RACING_PHYSICS_KNOWLEDGE = `
CORE PRINCIPLES:
1. **The Friction Circle:** A tire has 100% grip. If you use 100% for braking, you have 0% for turning. 
   - *Error:* Turning while 100% braking = Understeer (Plowing).
   - *Fix:* "Trail braking" (releasing brake pressure as steering angle increases).

2. **Weight Transfer:** - Braking shifts weight forward (Front grip UP, Rear grip DOWN).
   - Accelerating shifts weight backward (Front grip DOWN, Rear grip UP).
   - *Error:* Lifting off throttle mid-corner shifts weight forward abruptly -> Oversteer (Spin risk).

3. **The geometric line vs. The racing line:**
   - We prioritize "Exit Speed" onto straights (Turn 15).
   - We prioritize "Entry Speed" into non-critical corners (Turn 11).
   - *Rule:* "Slow in, Fast out" applies to corners leading onto long straights.

THUNDERHILL EAST SPECIFICS:
- **Turn 2 (Carousel):** Long duration. Patience is key. Late apex allows full throttle earlier.
- **Turn 5 (Bypass):** Uphill blind entry. The car gains grip due to compression. Commit to throttle.
- **Turn 9 (Crest):** The road drops away. Grip reduces drastically at the top. All braking must be done *before* the crest.
`;

        const promptFlash = `
You are a Race Engineer. 
Reference the [RACING_PHYSICS_KNOWLEDGE] below to diagnose the user's telemetry.

${RACING_PHYSICS_KNOWLEDGE}

INPUT DATA:
- Telemetry Context: ${contextString}

TASK:
1. Identify the corner with the biggest "Time Loss" (Delta).
2. Use the [RACING_PHYSICS_KNOWLEDGE] to explain the error.

OUTPUT FORMAT:
**Directive:** [Short, actionable instruction]
### Analysis
[Detailed explanation using markdown]

EXAMPLE REASONING:
- *Observation:* Driver is applying 80% Brake and 50% Steering in Turn 2 Entry.
- *Physics Violation:* Friction Circle. The tire cannot support this load.
- *Output:*
**Directive:** Trail off the brake before turning in.
### Analysis
You are overloading the front tires in T2 (See: Friction Circle).
`;

        const promptPro = `
You are an Elite Driver Coach. 
Use the [RACING_PHYSICS_KNOWLEDGE] to analyze the correlation between Telemetry and ideal physics.

${RACING_PHYSICS_KNOWLEDGE}

### EXAMPLES OF EXPERT ANALYSIS (FEW-SHOT):

**Scenario A (Bad Coaching):** "You went too fast in Turn 2. Slow down." -> *Critique: Too generic.*

**Scenario B (Expert Coaching - EMULATE THIS):**
"In Turn 2, the video shows your hands fighting the wheel (counter-steering) while the telemetry shows a sudden lift in throttle. 
**Directive:** Keep a 'maintenance throttle' (10-20%) to keep the rear planted.
### Analysis
**Physics Diagnosis:** By lifting off mid-corner, you triggered 'Lift-Off Oversteer' (Rule #2: Weight Transfer)."

### YOUR MISSION:
Analyze the user's session context below. Look for:
1. **Inputs:** Are the brake/throttle traces smooth or jagged (indicating uncertainty)?
2. **Correlation:** Explain the physics behind the mistakes.

OUTPUT FORMAT:
**Directive:** [Short, actionable instruction. Max 10 words.]
### Analysis
[Detailed markdown analysis including headers like **Physics Diagnosis**, **Telemetry**, **Fix**]

INPUT CONTEXT:
${contextString}
`;

        const prompt = `
${model === "pro" ? promptPro : promptFlash}
 `;

        // Construct Parts
        const parts: any[] = [{ text: prompt }];

        if (images) {
          images.forEach(b64 => {
            parts.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: b64
              }
            });
          });
        }

        const requestBody: any = {
          contents: [
            {
              parts: parts,
            },
          ],
        };


        if (model === "pro") {
          // Gemini 3 Pro Preview with Thinking High
          (requestBody as any).generationConfig = {
            thinkingConfig: {
              thinkingLevel: "high"
            }
          };
        }



        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || response.statusText);
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        setStatus((prev) => ({ ...prev, state: "success" }));
        return generatedText || "";
      } catch (err: unknown) {
        console.error("Gemini Cloud generation failed:", err);
        setStatus((prev) => ({
          ...prev,
          state: "error",
          error: (err as Error).message || "Unknown error",
        }));
        return "";
      }
    },
    [apiKey]
  );

  // New: Audio Generation Helper
  const generateAudio = useCallback(async (text: string, voiceName: string = "Zephyr"): Promise<Blob | null> => {
    return new Promise<Blob | null>(async (resolve) => {
      try {
        const client = new GoogleGenAI({
          apiKey: apiKey || '',
          httpOptions: { apiVersion: 'v1alpha' }
        });
        const model = 'models/gemini-2.5-pro-preview-tts';

        const config = {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName
              }
            }
          }
        };

        const response = await client.models.generateContentStream({
          model,
          config,
          contents: [{
            role: 'user',
            parts: [{ text: `Task: Read the following text aloud verbatim. Do not add any other words. Text: "${text}"` }]
          }]
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

        if (audioParts.length > 0) {
          const wavBuffer = convertToWav(audioParts, audioMimeType || 'audio/pcm; rate=24000');
          resolve(new Blob([wavBuffer], { type: 'audio/wav' }));
        } else {
          resolve(null);
        }

      } catch (e) {
        console.error("Gemini Pro Audio Gen Failed:", e);
        resolve(null);
      }
    });

  }, [apiKey]);

  return {
    status,
    generateFeedback,
    generateAudio, // Exported but currently no-op
    setApiKey,
    apiKey // Export apiKey to be used by service
  };
};

