import { useState } from "react";
import CanvasTimeline, { TimelineEvent } from "./components/CanvasTimeline";

const start = new Date("2024-12-01T08:00:00Z");

const demoEvents: TimelineEvent[] = [
  {
    id: "evt-01",
    timestamp: "2024-12-01T08:12:20Z",
    title: "Warm-up",
    subtitle: "Engines synchronised",
    description: "All sensor arrays recalibrated against the orbital reference.",
    wave: 1,
    color: "#9d4edd"
  },
  {
    id: "evt-02",
    timestamp: "2024-12-01T08:24:10Z",
    title: "Pulse spike",
    subtitle: "Minor anomaly",
    description: "Detected short-lived current spike during low-orbit pass.",
    wave: 1,
    color: "#ff9f1c"
  },
  {
    id: "evt-03",
    timestamp: "2024-12-01T09:05:05Z",
    title: "Wave gate",
    subtitle: "Wave 2 entry",
    description: "Guidance ring locked, long-range telemetry stable.",
    wave: 2,
    color: "#2ec4b6"
  },
  {
    id: "evt-04",
    timestamp: "2024-12-01T09:47:33Z",
    title: "Telemetry drop",
    subtitle: "Recovered",
    description: "Ground link dipped for 12s while crosslink rerouted.",
    wave: 2,
    color: "#ff6b6b"
  },
  {
    id: "evt-05",
    timestamp: "2024-12-01T10:30:12Z",
    title: "Wave crest",
    subtitle: "Wave 3 peak",
    description: "Payload separation completed with ±0.4s drift.",
    wave: 3,
    color: "#5f0f40"
  },
  {
    id: "evt-06",
    timestamp: "2024-12-01T11:18:45Z",
    title: "Calibration",
    subtitle: "Optics realigned",
    description: "Star tracker cross-check produced super-resolution frame.",
    wave: 3,
    color: "#4cc9f0"
  },
  {
    id: "evt-07",
    timestamp: "2024-12-01T12:04:04Z",
    title: "Wave 4",
    subtitle: "Deep field sweep",
    description: "Captured 24 spectral windows with overlapping cadence.",
    wave: 4,
    color: "#ff7b00"
  },
  {
    id: "evt-08",
    timestamp: "2024-12-01T13:40:24Z",
    title: "Signal sync",
    subtitle: "Wave close",
    description: "Array phase locked for extended dwell.",
    wave: 4,
    color: "#00b4d8"
  }
];

function App() {
  const [clickedEvent, setClickedEvent] = useState<TimelineEvent | null>(null);

  return (
    <main className="app-shell">
      <section className="intro">
        <p>Canvas prototype</p>
        <h1>Mission operations timeline</h1>
        <p>
          Drag horizontally to pan through time, use your trackpad/scroll wheel or
          the zoom buttons to change scale, and click spikes to inspect the
          underlying event.
        </p>
      </section>

      <CanvasTimeline
        startTime={start}
        events={demoEvents}
        onEventClick={setClickedEvent}
      />

      {clickedEvent && (
        <div className="click-feedback">
          <strong>{clickedEvent.title}</strong>
          <span>Wave {clickedEvent.wave}</span>
          <span>{new Date(clickedEvent.timestamp).toLocaleString()}</span>
        </div>
      )}
    </main>
  );
}

export default App;
