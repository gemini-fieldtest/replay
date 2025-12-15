import type { TelemetryFrame } from '../utils/telemetryParser';
import type { LapData } from '../utils/lapAnalysis';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { CloudModel } from '../hooks/useGeminiCloud';

interface ReportGenerationParams {
    laps: LapData[];
    currentFrame: TelemetryFrame | null;
    trackDetails: string;
    videoFile?: File | null;
    videoOffset?: number;
    trackPoints?: { latitude: number; longitude: number }[];
    trackMapImage?: string | null;
    generateFeedback: (model: CloudModel, context: string, images?: string[]) => Promise<string>;
    generateAudio?: (text: string, voice?: string) => Promise<Blob | null>;
    onStatusUpdate: (status: string) => void;
}

export const generateCoachReport = async ({
    laps,
    trackDetails,
    videoFile,
    videoOffset = 0,
    trackPoints,
    trackMapImage,
    generateFeedback,
    generateAudio,
    onStatusUpdate
}: ReportGenerationParams) => {
    // 1. Data Aggregation
    onStatusUpdate("Aggregating Telemetry...");
    // Filter for valid, complete laps to avoid pre-race noise
    const validLaps = laps.filter(l => l.isComplete && l.lapTime > 0);
    if (validLaps.length === 0) throw new Error("No valid complete laps found.");

    const bestLap = validLaps.reduce((best, lap) => best.lapTime < lap.lapTime ? best : lap, validLaps[0]);
    const totalLaps = validLaps.length;
    // Calculate simple consistency (std dev of lap times)
    const avgLap = validLaps.reduce((sum, l) => sum + l.lapTime, 0) / totalLaps;
    const consistency = Math.sqrt(validLaps.reduce((sum, l) => sum + Math.pow(l.lapTime - avgLap, 2), 0) / totalLaps).toFixed(3);

    const contextStats = `
Total Valid Laps: ${totalLaps}
Best Lap: ${bestLap ? bestLap.lapTime.toFixed(3) : 'N/A'}
Consistency (Std Dev): ${consistency}s
Track: ${trackDetails.slice(0, 100)}...
    `;

    // Process Track Points for Context
    let trackMapContext = "";
    if (trackPoints && trackPoints.length > 0) {
        // Downsample to ~50 points to define shape without huge context
        const step = Math.ceil(trackPoints.length / 50);
        const sampledPoints = trackPoints.filter((_, i) => i % step === 0).map(p => `[${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}]`).join(', ');
        trackMapContext = `Track Map (Sampled Lat/Lon): [${sampledPoints}]`;
    }

    // 2. Video Processing (Frame Extraction)
    onStatusUpdate("Processing Video...");
    const images: string[] = [];

    // Add Track Map if available
    if (trackMapImage) {
        // If it's a data URL, strip header
        const base64 = trackMapImage.includes(',') ? trackMapImage.split(',')[1] : trackMapImage;
        images.push(base64);
    }

    if (videoFile) {
        try {
            // Extract 3 frames: Start, Mid, End of best lap (simplification)
            const bestLapStart = bestLap.frames[0].time;
            const duration = bestLap.lapTime;
            const timestamps = [
                bestLapStart + duration * 0.25,
                bestLapStart + duration * 0.5,
                bestLapStart + duration * 0.75
            ];

            images.push(...await extractFramesFromVideo(videoFile, timestamps, videoOffset));
        } catch (e) {
            console.error("Frame extraction led to error", e);
            onStatusUpdate("Video processing failed, continuing...");
        }
    }

    // 3. Report Generation
    onStatusUpdate("Generating Coach Analysis (Gemini 3 Pro)...");
    const systemPrompt = `
You are an Elite Formula 1 Performance Coach (Role: "The Chief Engineer").
Generate a comprehensive markdown report for the driver.
Use the provided telemetry summary and the attached video frames (if any) to ground your advice.

Structure:
# Race Analysis Report
## Executive Summary
[High level view of pace and consistency]

## Key Areas for Improvement
[Bulleted list based on data]

## Turn Analysis
[Reference specific frames if available, e.g. "In the mid-corner frame..."]

## Engineer's Verdict
[Final encouraging but strict summary]
`;

    const reportContext = `
${contextStats}

Top Speed: ${Math.max(...(bestLap?.frames.map(f => f.speed) || [0])).toFixed(0)} km/h
Min Speed (Apex): ${Math.min(...(bestLap?.frames.map(f => f.speed) || [0])).toFixed(0)} km/h
    `;

    // Call Cloud Hook
    const fullPrompt = `${systemPrompt}\n\nCONTEXT:\n${reportContext}\n\n${trackMapContext}`;
    const reportMarkdown = await generateFeedback('pro', fullPrompt, images);

    if (!reportMarkdown) {
        throw new Error("Failed to generate report.");
    }

    // 4. Podcast Script Generation
    onStatusUpdate("Drafting Podcast Script...");
    const scriptPrompt = `
Based on the following race report, verify the key facts and generate a 2-person podcast script.
Host: "Chip" (Energetic, American, asking questions).
Expert: "Stig" (British, dry wit, deep technical knowledge, the Coach).

The script should be about 5 minutes long (approx 750 words).
Format the output as JSON:
[
  { "speaker": "Chip", "text": "..." },
  { "speaker": "Stig", "text": "..." }
]
Only return the JSON.

REPORT:
${reportMarkdown}
    `;

    let scriptJson: any[] = [];
    try {
        const rawScript = await generateFeedback('pro', scriptPrompt);
        const jsonStr = rawScript.replace(/```json/g, '').replace(/```/g, '').trim();
        scriptJson = JSON.parse(jsonStr);
    } catch (e) {
        console.error("Script generation failed", e);
        scriptJson = [
            { speaker: "Chip", text: "Welcome back. We have the data." },
            { speaker: "Stig", text: "Indeed. The driving was... adequate." }
        ];
    }

    // 5. Audio Synthesis (Gemini Flash Audio)
    onStatusUpdate("Synthesizing Podcast Audio (Gemini Flash)...");

    const audioChunks: { blob: Blob, name: string }[] = [];
    if (generateAudio) {
        try {
            // Sequential generation
            let i = 1;
            for (const line of scriptJson) {
                const voice = line.speaker === "Stig" ? "Fenrir" : "Zephyr";
                // "Fenrir" is deep/expert, "Zephyr" is energetic/host

                const clipBlob = await generateAudio(line.text, voice);
                if (clipBlob) {
                    audioChunks.push({ blob: clipBlob, name: `line_${String(i).padStart(3, '0')}_${line.speaker}.wav` });
                }
                i++;
            }
        } catch (e) { console.error("Audio loop failed", e); }
    }

    const scriptText = scriptJson.map(line => `${line.speaker}: ${line.text}`).join('\n\n');

    // 6. Packaging
    onStatusUpdate("Packaging Report...");
    const zip = new JSZip();

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const folderName = `CoachReport_${dateStr}_${timeStr}`;
    const folder = zip.folder(folderName);

    if (folder) {
        folder.file("report.md", reportMarkdown);
        folder.file("podcast_script.txt", scriptText);

        if (audioChunks.length > 0) {
            const audioFolder = folder.folder("podcast_audio");
            if (audioFolder) {
                audioChunks.forEach(chunk => {
                    audioFolder.file(chunk.name, chunk.blob);
                });
            }
            // Add a playlist file
            const m3u8 = audioChunks.map(c => `podcast_audio/${c.name}`).join('\n');
            folder.file("podcast_playlist.m3u", m3u8);

            // Merge audio files into one
            try {
                const audioBuffers = await Promise.all(audioChunks.map(c => c.blob.arrayBuffer()));
                if (audioBuffers.length > 0) {
                    const HEADER_SIZE = 44;
                    const totalDataLen = audioBuffers.reduce((acc, b) => acc + Math.max(0, b.byteLength - HEADER_SIZE), 0);

                    const combinedBuffer = new Uint8Array(HEADER_SIZE + totalDataLen);

                    // Copy header from first file
                    const firstHeader = new Uint8Array(audioBuffers[0].slice(0, HEADER_SIZE));
                    combinedBuffer.set(firstHeader, 0);

                    // Append data chunks
                    let offset = HEADER_SIZE;
                    for (const buffer of audioBuffers) {
                        if (buffer.byteLength > HEADER_SIZE) {
                            const data = new Uint8Array(buffer.slice(HEADER_SIZE));
                            combinedBuffer.set(data, offset);
                            offset += data.length;
                        }
                    }

                    // Update Header Size Fields (Little Endian)
                    const view = new DataView(combinedBuffer.buffer);
                    // ChunkSize (Offset 4) = 36 + SubChunk2Size
                    view.setUint32(4, 36 + totalDataLen, true);
                    // Subchunk2Size (Offset 40) = NumSamples * NumChannels * BitsPerSample/8 = totalDataLen
                    view.setUint32(40, totalDataLen, true);

                    folder.file("podcast_full.wav", combinedBuffer);
                }
            } catch (e) {
                console.error("Failed to merge audio files", e);
            }
        }
    }

    onStatusUpdate("Downloading...");
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${folderName}.zip`);

    onStatusUpdate("Complete!");
    return true;
};

// Helper: Frame Extraction
async function extractFramesFromVideo(videoFile: File, timestamps: number[], offset: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(videoFile);
        video.muted = true;
        video.playsInline = true;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const frames: string[] = [];
        let currentIndex = 0;

        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            seekNext();
        };

        video.onerror = (e) => reject(e);

        const seekNext = () => {
            if (currentIndex >= timestamps.length) {
                resolve(frames);
                URL.revokeObjectURL(video.src);
                return;
            }
            const targetTime = Math.max(0, timestamps[currentIndex] + offset);
            video.currentTime = targetTime;
        };

        video.onseeked = () => {
            if (ctx) {
                ctx.drawImage(video, 0, 0);
                frames.push(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]);
            }
            currentIndex++;
            seekNext();
        };
    });
}
