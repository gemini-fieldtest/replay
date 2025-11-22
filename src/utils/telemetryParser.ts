import Papa from 'papaparse';

export interface TelemetryFrame {
  time: number; // Elapsed time in seconds
  latitude: number;
  longitude: number;
  speed: number; // km/h
  rpm: number;
  throttle: number; // %
  brake: number; // %
  gear: number;
  steering: number; // degrees
  gForceLat: number;
  gForceLong: number;
  batteryVoltage: number;
  coolantTemp: number;
  oilPressure: number;
  oilTemp: number;
  altitude: number;
  gradient: number;
  fuelLevel: number;
  brakePressure: number;
  exhaustTemp: number;
  comboG: number;
  verticalVelocity: number;
  radiusOfTurn: number;
}

// Helper to parse coordinate string like "35°29.340126 N" to decimal degrees
function parseCoordinate(coord: string): number {
  if (!coord) return 0;
  const match = coord.match(/(\d+)°([\d.]+)\s*([NSEW])/);
  if (!match) return 0;
  
  const degrees = parseFloat(match[1]);
  const minutes = parseFloat(match[2]);
  const direction = match[3];
  
  let decimal = degrees + (minutes / 60);
  
  if (direction === 'S' || direction === 'W') {
    decimal = -decimal;
  }
  
  return decimal;
}

export function parseTelemetry(csvText: string): Promise<TelemetryFrame[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      dynamicTyping: true, // This might be risky for coordinates if they are strings with symbols
      skipEmptyLines: true,
      complete: (results) => {
        const frames: TelemetryFrame[] = results.data
          .map((row: unknown) => {
            const r = row as Record<string, any>;
            // Skip invalid rows
            if (!r['Latitude'] || !r['Longitude']) return null;

            return {
              altitude: r['Height (m)'] || 0,
              gradient: r['Gradient (%)'] || 0,
              fuelLevel: r['Fuel Level (%)'] || 0,
              brakePressure: r['Brake Pressure (bar)'] || 0,
              exhaustTemp: r['Exhaust Temperature (°C)'] || 0,
              comboG: r['ComboAcc (g)'] || 0,
              verticalVelocity: r['Vertical velocity (km/h)'] || 0,
              radiusOfTurn: r['Radius of turn (m)'] || 0,
              time: r['Elapsed time (s)'] || 0,
              latitude: parseCoordinate(r['Latitude']),
              longitude: parseCoordinate(r['Longitude']),
              speed: r['Speed (km/h)'] || 0,
              rpm: r['Engine Speed (rpm)'] || 0,
              throttle: r['Throttle Position (%)'] || 0,
              brake: r['Brake Position (%)'] || 0,
              gear: r['Gear ((null))'] || 0, // Check if this field is populated
              steering: r['Steering Angle (Degrees)'] || 0,
              gForceLat: r['Lateral acceleration (g)'] || 0,
              gForceLong: r['Longitudinal acceleration (g)'] || 0,
              batteryVoltage: r['Battery Voltage (V)'] || 0,
              coolantTemp: r['Coolant Temperature (°C)'] || 0,
              oilPressure: r['Oil Pressure (bar)'] || 0,
              oilTemp: r['Oil Temperature (°C)'] || 0,
            };
          })
          .filter((frame): frame is TelemetryFrame => frame !== null);
        
        resolve(frames);
      },
      error: (error: Error) => {
        reject(error);
      }
    });
  });
}
