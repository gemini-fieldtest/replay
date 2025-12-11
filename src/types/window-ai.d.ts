export {};

declare global {
  interface Window {
    // New Prompt API (Chrome 138+ / Canary)
    LanguageModel: {
      create(options?: AILanguageModelCreateOptions): Promise<AILanguageModel>;
      capabilities(): Promise<AICapabilities>; // Some versions use this
      availability(): Promise<'readily' | 'after-download' | 'no' | 'downloading'>; // Docs mention this
      params(): Promise<AIModelParams>; // Demo script uses this
    } | undefined;
    
    // Legacy / Alternative namespace
    ai?: {
      languageModel?: Window['LanguageModel'];
    };
  }

  interface AIModelParams {
    defaultTopK: number;
    maxTopK: number;
    defaultTemperature: number;
    maxTemperature: number;
  }

  interface AICapabilities {
    available: 'readily' | 'after-download' | 'no';
  }

  interface AILanguageModelCreateOptions {
    initialPrompts?: AIPrompt[];
    systemPrompt?: string; 
    temperature?: number;
    topK?: number;
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }

  interface AIPrompt {
      role: 'system' | 'user' | 'assistant';
      content: string;
  }

  interface AILanguageModel {
    prompt(input: string): Promise<string>;
    promptStreaming(input: string): ReadableStream<string>;
    destroy(): void;
    clone(): Promise<AILanguageModel>;
    
    // Token counting (demo script usage)
    countPromptTokens?(input: string): Promise<number>;
    measureInputUsage?(input: string): Promise<number>;
  }
}
