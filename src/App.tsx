import { useState } from "react";
import CanvasTimeline, { TimelineEvent } from "./components/CanvasTimeline";
import { demoEvents, timelineStart } from "./data/demoEvents";

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
        startTime={timelineStart}
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
