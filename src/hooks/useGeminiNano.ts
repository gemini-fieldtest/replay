import { useState, useEffect, useRef, useCallback } from "react";

export interface NanoStatus {
  isAvailable: boolean;
  state: "initializing" | "ready" | "error" | "unavailable";
  error?: string;
}

export const useGeminiNano = () => {
  const [status, setStatus] = useState<NanoStatus>({
    isAvailable: false,
    state: "initializing",
  });

  const sessionRef = useRef<AILanguageModel | null>(null);

  useEffect(() => {
    const initNano = async () => {
      try {
        // 1. Check for API existence (Global LanguageModel)
        if (!window.LanguageModel) {
          if (window.ai?.languageModel) {
            // Quietly handle alias
            window.LanguageModel = window.ai.languageModel;
          } else {
            const msg =
              "Gemini Nano not found. Please enable 'Prompt API for Gemini Nano' in chrome://flags and ensure you have Chrome Canary. See README for setup.";
            console.error(`[useGeminiNano] ${msg}`);
            setStatus({ isAvailable: false, state: "unavailable", error: msg });
            return;
          }
        }

        // 2. Check Availability
        let availability = "no";
        try {
          availability = await window.LanguageModel!.availability();
        } catch {
          if ("capabilities" in window.LanguageModel!) {
            const caps = await window.LanguageModel!.capabilities();
            availability = caps.available;
          }
        }

        if (availability === "no") {
          const msg =
            "Gemini Nano available='no'. You may need to restart Chrome or check chrome://components > Optimization Guide On Device Model.";
          console.warn(`[useGeminiNano] ${msg}`);
          setStatus({
            isAvailable: false,
            state: "unavailable",
            error: msg,
          });
          return;
        }

        // 3. Create Session
        const session = await window.LanguageModel!.create({
          initialPrompts: [
            {
              role: "system",
              content: `You are a Race Spotter.
Check the "flags" in the input JSON. Priority is Top to Bottom.

PRIORITY 1: SAFETY
- If safety_status is "UNSTABLE" -> "Smooth it out! Reset."

PRIORITY 2: CRITICAL ERRORS
- If error_type is "LATE_BRAKE_T9" -> "BRAKE! Crest approaching!"
- If error_type is "COASTING_DETECTED" -> "Don't coast. Gas or Brake."
- If driver_state is "PANIC" -> "Smooth inputs."

PRIORITY 3: PACE
- If opportunity is "UNDER_DRIVING_T5" -> "Trust the compression. Full throttle."
- If tire_usage is "LOW" -> "Use more tire. Lean on it."
- If flags are clean and delta is Green -> "Great pace."

Input JSON:`,
            },
          ],
        });

        sessionRef.current = session;
        setStatus({ isAvailable: true, state: "ready" });
      } catch (err: unknown) {
        console.error("Failed to initialize Gemini Nano:", err);
        setStatus({
          isAvailable: false,
          state: "error",
          error: (err as Error).message || "Unknown error initializing Nano",
        });
      }
    };

    initNano();

    return () => {
      if (sessionRef.current) {
        if (typeof sessionRef.current.destroy === "function") {
          sessionRef.current.destroy();
        }
      }
    };
  }, []);

  const generateFeedback = useCallback(
    async (contextString: string | object) => {
      if (!sessionRef.current || status.state !== "ready") {
        return "";
      }

      try {
        let prompt;
        if (typeof contextString === "object") {
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
        // Clean up response (remove Directive: prefix and quotes if present)
        return response
          .replace(/^(?:Directive|Coaching Directive|Advice):\s*/i, "")
          .replace(/^["']|["']$/g, "")
          .trim();
      } catch (err) {
        console.error("Nano generation failed:", err);
        return "";
      }
    },
    [status.state]
  );

  return {
    status,
    generateFeedback,
  };
};
