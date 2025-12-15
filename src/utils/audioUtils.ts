export interface WavConversionOptions {
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
}

export function parseMimeType(mimeType: string): WavConversionOptions {
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

export function createWavHeader(dataLength: number, options: WavConversionOptions) {
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

export function convertToWav(rawDataChunks: string[], mimeType: string) {
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
