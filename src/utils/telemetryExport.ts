import { type TelemetryFrame } from "./telemetryParser";

export function exportToCSV(data: TelemetryFrame[]): string {
    // Headers matching standard GPSD/Telemetry format used in the project
    const headers = [
        "Time",
        "Latitude",
        "Longitude",
        "Speed (km/h)",
        "Altitude",
        "Gradient (%)",
        "Engine Speed (rpm)",
        "Throttle Position (%)",
        "Brake Position (%)",
        "Gear ((null))",
        "Steering Angle (Degrees)",
        "Lateral acceleration (g)",
        "Longitudinal acceleration (g)",
        "Battery Voltage (V)",
        "Coolant Temperature (°C)",
        "Oil Pressure (bar)",
        "Oil Temperature (°C)",
        "Fuel Level (%)",
        "Brake Pressure (bar)",
        "Exhaust Temperature (°C)",
        "ComboAcc (g)",
        "Vertical velocity (km/h)",
        "Radius of turn (m)"
    ];

    // Helper to format float to string to avoid scientific notation if needed,
    // though standard JS toString is usually fine for CSV.
    // We'll stick to simple string conversion.

    const rows = data.map(frame => {
        return [
            frame.time.toFixed(3), // Time
            frame.latitude.toString(), // Latitude - keeping decimal format (parser should handle it)
            frame.longitude.toString(), // Longitude
            frame.speed.toFixed(2), // Speed
            frame.altitude.toFixed(2),
            frame.gradient.toFixed(2),
            frame.rpm.toFixed(0),
            frame.throttle.toFixed(2),
            frame.brake.toFixed(2),
            frame.gear.toString(),
            frame.steering.toFixed(2),
            frame.gForceLat.toFixed(3),
            frame.gForceLong.toFixed(3),
            frame.batteryVoltage.toFixed(1),
            frame.coolantTemp.toFixed(1),
            frame.oilPressure.toFixed(1),
            frame.oilTemp.toFixed(1),
            frame.fuelLevel.toFixed(1),
            frame.brakePressure.toFixed(1),
            frame.exhaustTemp.toFixed(1),
            frame.comboG.toFixed(3),
            frame.verticalVelocity.toFixed(2),
            frame.radiusOfTurn.toFixed(2)
        ].join(",");
    });

    return [headers.join(","), ...rows].join("\n");
}

export function downloadSessionCSV(data: TelemetryFrame[], filename: string = "session_export.csv") {
    if (!data || data.length === 0) {
        console.warn("No data to export");
        return;
    }

    const csvContent = exportToCSV(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export const downloadSessionJSON = (
    data: TelemetryFrame[],
    messages: any[],
    metadata: {
        track?: string,
        source?: string,
        date?: string
    },
    filename: string
) => {
    const sessionData = {
        version: "1.0",
        sessionId: new Date().toISOString().replace(/[:.]/g, '-'),
        date: metadata.date || new Date().toISOString(),
        track: metadata.track || "unknown",
        source: metadata.source || "live",
        totalFrames: data.length,
        duration: data.length > 0 ? (data[data.length - 1].time - data[0].time) : 0,
        telemetry: data,
        events: messages.map(m => ({
            id: m.id,
            timestamp: m.timestamp,
            telemetryTime: m.telemetryTime,
            type: "coach_message",
            data: {
                text: m.text,
                model: m.mode,
                analysis: m.analysis, // raw analysis string if available
                type: m.type // positive/neutral/info
            }
        }))
    };

    const jsonString = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
};
