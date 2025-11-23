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
