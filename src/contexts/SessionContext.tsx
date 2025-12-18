import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// Use a loosely typed interface for now to avoid circular dependency issues, 
// or redefine the minimal part of CoachMessage we need.
// Ideally, we imports the type, but let's define a compatible interface here for the context.
export interface SavedRecommendation {
    id: number;
    text: string;
    type: 'positive' | 'neutral' | 'info';
    timestamp: number;
    mode?: string;
    telemetryTime: number;
    generationTime?: number;
    analysis?: string;
    isPredictive?: boolean;
    // We can add more metadata if needed
}

interface SessionContextType {
    sessionId: string;
    startTime: number;
    isRecording: boolean;
    recommendations: SavedRecommendation[];
    startNewSession: () => void;
    toggleRecording: () => void;
    addRecommendation: (rec: SavedRecommendation) => void;
    saveSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSession = () => {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
};

export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const generateSessionId = () => new Date().toISOString().replace(/[:.]/g, '-');

    const [sessionId, setSessionId] = useState<string>(generateSessionId());
    const [startTime, setStartTime] = useState<number>(Date.now());
    const [isRecording, setIsRecording] = useState<boolean>(false); // Default to NOT recording
    const [recommendations, setRecommendations] = useState<SavedRecommendation[]>([]);

    const startNewSession = useCallback(() => {
        setSessionId(generateSessionId());
        setStartTime(Date.now());
        setRecommendations([]);
        setIsRecording(true); // Auto-start recording on new session
        console.log("New Session Started");
    }, []);

    const toggleRecording = useCallback(() => {
        setIsRecording(prev => !prev);
    }, []);

    const addRecommendation = useCallback((rec: SavedRecommendation) => {
        if (!isRecording) return;
        setRecommendations(prev => [...prev, rec]);
    }, [isRecording]);

    const saveSession = useCallback(() => {
        if (recommendations.length === 0) {
            alert("No recommendations to save.");
            return;
        }

        const data = {
            sessionId,
            startTime: new Date(startTime).toISOString(),
            saveTime: new Date().toISOString(),
            totalRecommendations: recommendations.length,
            recommendations
        };

        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setIsRecording(false); // Stop recording after save
    }, [sessionId, startTime, recommendations]);

    return (
        <SessionContext.Provider value={{
            sessionId,
            startTime,
            isRecording,
            recommendations,
            startNewSession,
            toggleRecording,
            addRecommendation,
            saveSession
        }}>
            {children}
        </SessionContext.Provider>
    );
};
