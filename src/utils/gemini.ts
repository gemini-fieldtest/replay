import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

if (!API_KEY) {
  console.warn("VITE_GEMINI_API_KEY is not set. Gemini integration will not work.");
}

const genAI = new GoogleGenerativeAI(API_KEY);

export const getGeminiResponse = async (prompt: string): Promise<string> => {
  if (!API_KEY) {
      throw new Error("API key not found. Please set VITE_GEMINI_API_KEY.");
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.0-pro-preview" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error generating content with Gemini:", error);
    throw error;
  }
};
