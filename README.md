# Race Replay

A high-performance telemetry visualization tool for racing data. Built with React, TypeScript, Vite, and Three.js.

![Race Replay Screenshot](https://via.placeholder.com/800x450?text=Race+Replay+Screenshot)

## Features

- **Interactive Track Map**:

  - **2D View**: Top-down view of the track with the car's current position.
  - **3D View**: Immersive 3D visualization showing track elevation changes (exaggerated for visibility).
  - **Performance Optimized**: Uses `Float32Array` and efficient rendering to handle large datasets smoothly.

- **Comprehensive Telemetry Gauges**:

  - **Analog Gauges**: Speed and RPM.
  - **G-Force Meter**: Visualizes lateral and longitudinal G-forces.
  - **Steering Wheel**: Real-time steering angle visualization.
  - **Pedal Inputs**: Throttle and Brake pressure bars.
  - **Running Graphs**: Real-time graphs for:
    - Combined Acceleration (G)
    - Vertical Velocity
    - Turn Radius
    - Gear
    - Gradient & Altitude
    - Temperatures (Coolant, Oil, Exhaust/Combo)
    - Battery Voltage & Fuel Level
    - Oil Pressure

- **Playback Controls**:

  - Play/Pause
  - Seek/Scrub through the timeline
  - Variable Playback Speed (0.1x to 10x)
  - Skip Forward/Back (100 frames)

- **Ideal Lap Analysis**:

  - **Ghost Car**: Visualizes the theoretical best lap as a ghost car racing alongside you.
  - **Lap Stitching**: Automatically calculates the ideal lap by combining the fastest sectors from all laps.

- **Performance Coach**:

  - **Real-time Feedback**: AI-powered coach provides live advice on throttle, brake, steering, and gear selection.
  - **Advanced Analysis**: Detects coasting, understeer, and brake aggression issues.
  - **Streaming Chat**: Interactive chat interface with diverse, personality-driven feedback.
  
### Coaching Strategies

The Performance Coach now supports two distinct strategies:

1.  **Reactive (Default)**:
    - Provides specific feedback *during* or *immediately after* a driving event.
    - Triggers include: Significant deviation from the ideal lap speed, terrain changes (uphill/downhill), and achieving "New Best" sector times.
    - Best for continuous performace monitoring.

2.  **Predictive**:
    - Analyzes your *previous completed laps* to identify "Mistake Zones" where you consistently lost time compared to your Ideal Lap.
    - Proactively alerts you *before* you reach specifically identified problem areas (e.g., "Heads up: You lost 15 km/h here last lap").
    - Stays silent when no historical mistakes are detected, allowing you to focus.
    - **Logic**: Uses a lookahead buffer (proportional to current speed) to scan for approaching Mistake Zones.

**Note**: Both strategies leverage the selected AI Model (Nano, Flash, Pro) to generate the final spoken advice in the persona of a Chief Engineer.

- **Dynamic File Loading**:
  - Automatically lists CSV files from the `data/` directory.
  - Select files via a dropdown menu.
  - **Local Upload**: prominent "Upload CSV" button to load your own telemetry files.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)

### Installation

1. Clone the repository:

   ```bash
   git clone git@github.com:gemini-fieldtest/replay.git
   cd replay
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

Start the development server:

```bash
npm run dev
```

This command will:

1. Generate a file manifest from the `data/` directory.
2. Start the Vite development server (usually at `http://localhost:5173`).

### Building for Production

Build the application for deployment:

```bash
npm run build
```

This will generate static assets in the `dist/` directory.

## Data Format

The application expects CSV files with specific headers. See `src/utils/telemetryParser.ts` for the full list of expected columns, which generally include:

- `Time` (or `Elapsed time (s)`)
- `Latitude`
- `Longitude`
- `Speed (km/h)`
- `Engine Speed (rpm)`
- `Throttle Position (%)`
- `Brake Pressure (bar)`
- `Steering Angle (Degrees)`
- `Lateral acceleration (g)`
- `Longitudinal acceleration (g)`
- `Height (m)` (Altitude)

## Technologies Used

- **React**: UI Framework
- **TypeScript**: Type Safety
- **Vite**: Build Tool & Dev Server
- **Three.js / React Three Fiber**: 3D Visualization
- **Tailwind CSS**: Styling
- **Recharts / Custom SVG**: Graphs and Gauges
- **Lucide React**: Icons

## License

MIT

## 🤖 Gemini Nano Setup

To unlock the AI Coaching features running locally in your browser, you must use **Google Chrome (Canary or Dev)** and enable the **Prompt API**.

### 1. Install Chrome Canary

The standard Chrome version may not have these features enabled yet. [Download Chrome Canary](https://www.google.com/chrome/canary/).

### 2. Enable Flags

Go to these URLs in Chrome and set them as follows:

1.  `chrome://flags/#optimization-guide-on-device-model`
    - Set to **Enabled BypassPerfRequirement**
2.  `chrome://flags/#prompt-api-for-gemini-nano`
    - Set to **Enabled**

### 3. Restart & Download

1.  Relaunch Chrome.
2.  Go to `chrome://components`
3.  Find **Optimization Guide On Device Model**
4.  Click **Check for update** to force the model download.
    - _Note: If it says "Component not updated", wait a few minutes and try again. The model is ~1GB._

Once installed, the errors in the console will disappear, and the "Race Spotter" triggers will be AI-powered!

### 4. Verify Installation

To confirm everything is working, open the Chrome DevTools Console (F12) and run:

```javascript
await window.LanguageModel.availability();
```

- **Expected**: `"readily"` (Ready to go!)
- **Expected**: `"after-download"` (Downloading... wait a bit)
- **Error**: `"no"` or `undefined` (Check flags above)
