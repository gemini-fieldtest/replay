export {};

declare global {
  interface Window {
    ai: {
      canCreateTextSession(): Promise<'readily' | 'after-download' | 'no'>;
      createTextSession(options?: TextSessionOptions): Promise<AITextSession>;
    };
  }

  interface TextSessionOptions {
    systemPrompt?: string;
    temperature?: number;
    topK?: number;
  }

  interface AITextSession {
    prompt(input: string): Promise<string>;
    promptStreaming(input: string): ReadableStream<string>;
    destroy(): void;
    clone(): Promise<AITextSession>;
  }
}
