import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./CanvasTimeline.css";

export type TimelineEvent = {
  id: string;
  timestamp: Date | string | number;
  title: string;
  subtitle?: string;
  description?: string;
  wave?: number;
  color?: string;
};

export interface CanvasTimelineProps {
  startTime: Date | string | number;
  events: TimelineEvent[];
  height?: number;
  minMsPerPixel?: number;
  maxMsPerPixel?: number;
  initialMsPerPixel?: number;
  zoomStep?: number;
  onEventClick?: (event: TimelineEvent) => void;
}

type NormalizedEvent = TimelineEvent & {
  timeMs: number;
  wave: number;
};

type EventHitbox = {
  id: string;
  event: NormalizedEvent;
  x: number;
  y: number;
  width: number;
  height: number;
};

type WaveSummary = {
  wave: number;
  events: NormalizedEvent[];
  minMs: number;
  maxMs: number;
};

const DEFAULT_COLOR = "#7f5af0";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeDate = (value: Date | string | number) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

const colorToRgba = (hex: string, alpha: number) => {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => `${c}${c}`)
      .join("");
  }
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const formatTimestamp = (value: number) => {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};

const formatClock = (value: number) => {
  const date = new Date(value);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
};

const formatDuration = (from: number, to: number) => {
  const diffMs = Math.max(to - from, 0);
  const seconds = Math.floor(diffMs / 1000) % 60;
  const minutes = Math.floor(diffMs / (1000 * 60)) % 60;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
};

const getTickStep = (msPerPixel: number) => {
  const targetPx = 120;
  const desiredMs = msPerPixel * targetPx;
  const steps = [
    1000,
    2000,
    5000,
    10_000,
    30_000,
    60_000,
    5 * 60_000,
    10 * 60_000,
    30 * 60_000,
    60 * 60_000,
    4 * 60 * 60_000,
    12 * 60 * 60_000,
    24 * 60 * 60_000
  ];
  for (const step of steps) {
    if (step >= desiredMs) return step;
  }
  return steps[steps.length - 1];
};

export const CanvasTimeline = ({
  startTime,
  events,
  height = 320,
  minMsPerPixel = 1000,
  maxMsPerPixel = 60 * 60 * 1000,
  initialMsPerPixel = 60_000,
  zoomStep = 0.7,
  onEventClick
}: CanvasTimelineProps) => {
  const startMs = useMemo(() => normalizeDate(startTime), [startTime]);
  const [msPerPixel, setMsPerPixel] = useState(initialMsPerPixel);
  const [offsetMs, setOffsetMs] = useState(0);
  const [activeEvent, setActiveEvent] = useState<NormalizedEvent | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef<{ x: number; offset: number } | null>(null);
  const hitboxesRef = useRef<EventHitbox[]>([]);
  const [width, setWidth] = useState(0);

  const normalizedEvents = useMemo<NormalizedEvent[]>(() => {
    return events
      .map((event) => ({
        ...event,
        timeMs: normalizeDate(event.timestamp),
        wave: event.wave ?? 0
      }))
      .sort((a, b) => a.timeMs - b.timeMs);
  }, [events]);

  const waveSummaries = useMemo<WaveSummary[]>(() => {
    const map = new Map<number, WaveSummary>();
    normalizedEvents.forEach((event) => {
      if (!map.has(event.wave)) {
        map.set(event.wave, {
          wave: event.wave,
          events: [],
          minMs: event.timeMs,
          maxMs: event.timeMs
        });
      }
      const entry = map.get(event.wave)!;
      entry.events.push(event);
      entry.minMs = Math.min(entry.minMs, event.timeMs);
      entry.maxMs = Math.max(entry.maxMs, event.timeMs);
    });
    return Array.from(map.values()).sort((a, b) => a.wave - b.wave);
  }, [normalizedEvents]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;

    const observer = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const clampOffset = useCallback(
    (next: number) => {
      const furthestEvent = normalizedEvents.at(-1)?.timeMs ?? startMs;
      const maxOffset = Math.max(furthestEvent - startMs, 0);
      return clamp(next, 0, maxOffset);
    },
    [normalizedEvents, startMs]
  );

  const zoom = useCallback(
    (direction: "in" | "out", anchorX?: number) => {
      const anchor = anchorX ?? width / 2;
      setMsPerPixel((prev) => {
        const factor = direction === "in" ? zoomStep : 1 / zoomStep;
        const next = clamp(prev * factor, minMsPerPixel, maxMsPerPixel);
        setOffsetMs((prevOffset) => {
          const anchorTime = startMs + prevOffset + anchor * prev;
          const nextOffset = anchorTime - startMs - anchor * next;
          return clampOffset(nextOffset);
        });
        return next;
      });
    },
    [clampOffset, maxMsPerPixel, minMsPerPixel, startMs, width, zoomStep]
  );

  const focusWave = useCallback(
    (summary: WaveSummary) => {
      if (!width) return;
      const waveDuration = Math.max(summary.maxMs - summary.minMs, 1000);
      const padded = waveDuration * 1.3;
      const targetMsPerPixel = clamp(
        padded / Math.max(width, 1),
        minMsPerPixel,
        maxMsPerPixel
      );
      setMsPerPixel(targetMsPerPixel);
      const center = (summary.minMs + summary.maxMs) / 2;
      const newOffset =
        center - startMs - (width * targetMsPerPixel) / 2;
      setOffsetMs(clampOffset(newOffset));
    },
    [clampOffset, maxMsPerPixel, minMsPerPixel, startMs, width]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const anchor =
        rect != null ? event.clientX - rect.left : width / 2;
      zoom(event.deltaY > 0 ? "out" : "in", anchor);
    },
    [width, zoom]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, offset: offsetMs };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!panRef.current) return;
    const deltaPx = panRef.current.x - event.clientX;
    const deltaMs = deltaPx * msPerPixel;
    setOffsetMs(clampOffset(panRef.current.offset + deltaMs));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.releasePointerCapture(event.pointerId);
    panRef.current = null;
  };

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hit = hitboxesRef.current.find(
      (box) =>
        x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
    );

    if (!hit) return;
    setActiveEvent(hit.event);
    onEventClick?.(hit.event);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const baselineY = height - 70;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(width, baselineY);
    ctx.stroke();

    // draw wave bands
    waveSummaries.forEach((wave, index) => {
      const startX =
        (wave.minMs - startMs - offsetMs) / msPerPixel;
      const endX =
        (wave.maxMs - startMs - offsetMs) / msPerPixel;
      if (endX < 0 || startX > width) return;
      const clampedStart = Math.max(startX, 0);
      const clampedEnd = Math.min(endX, width);
      ctx.fillStyle = colorToRgba(
        wave.events[0]?.color ?? DEFAULT_COLOR,
        index % 2 === 0 ? 0.08 : 0.05
      );
      ctx.fillRect(clampedStart, 20, clampedEnd - clampedStart, baselineY - 40);
    });

    // ticks
    const tickStep = getTickStep(msPerPixel);
    const visibleStart = startMs + offsetMs;
    const visibleEnd = visibleStart + width * msPerPixel;
    const firstTick = Math.ceil(visibleStart / tickStep) * tickStep;

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";

    for (let tick = firstTick; tick < visibleEnd; tick += tickStep) {
      const x = (tick - startMs - offsetMs) / msPerPixel;
      if (x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, baselineY);
      ctx.lineTo(x, baselineY + 8);
      ctx.stroke();
      ctx.fillText(formatClock(tick), x, baselineY + 24);
    }

    const hitboxes: EventHitbox[] = [];
    normalizedEvents.forEach((event) => {
      const relative = event.timeMs - startMs - offsetMs;
      const x = relative / msPerPixel;
      if (x < -10 || x > width + 10) return;
      const spikeHeight = 90;
      const spikeWidth = 10;
      const gradient = ctx.createLinearGradient(x, baselineY - spikeHeight, x, baselineY);
      const color = event.color ?? DEFAULT_COLOR;
      gradient.addColorStop(0, colorToRgba(color, 0));
      gradient.addColorStop(0.35, colorToRgba(color, 0.35));
      gradient.addColorStop(1, colorToRgba(color, 0.95));
      ctx.fillStyle = gradient;

      ctx.beginPath();
      ctx.moveTo(x, baselineY - spikeHeight);
      ctx.lineTo(x + spikeWidth / 2, baselineY);
      ctx.lineTo(x - spikeWidth / 2, baselineY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#f8f9ff";
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(event.title, x, baselineY - spikeHeight - 6);

      hitboxes.push({
        id: event.id,
        event,
        x: x - spikeWidth,
        y: baselineY - spikeHeight,
        width: spikeWidth * 2,
        height: spikeHeight
      });
    });

    hitboxesRef.current = hitboxes;
  }, [
    height,
    msPerPixel,
    normalizedEvents,
    offsetMs,
    startMs,
    waveSummaries,
    width
  ]);

  return (
    <div className="timeline-card">
      <div className="timeline-heading">
        <div>
          <p>Live operations feed</p>
          <h1>Canvas-based horizontal timeline</h1>
        </div>
        <div className="control-cluster">
          <span>Zoom</span>
          <div className="control-buttons">
            <button onClick={() => zoom("out")}>−</button>
            <button onClick={() => zoom("in")}>+</button>
            <button
              onClick={() => {
                setOffsetMs(0);
                setMsPerPixel(initialMsPerPixel);
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="timeline-canvas-shell" ref={containerRef}>
        <canvas
          ref={canvasRef}
          height={height}
          style={{ height, width: "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleClick}
        />
        <div className="timeline-meta">
          <span>Start: {formatTimestamp(startMs)}</span>
          <span>Scale: {msPerPixel.toFixed(0)} ms / px</span>
          <span>Offset: {formatDuration(startMs, startMs + offsetMs)}</span>
        </div>
      </div>

      {activeEvent && (
        <div className="event-detail">
          <div>
            <p>Wave {activeEvent.wave}</p>
            <h2>{activeEvent.title}</h2>
            {activeEvent.subtitle && <p>{activeEvent.subtitle}</p>}
            <small>{formatTimestamp(activeEvent.timeMs)}</small>
            {activeEvent.description && <p>{activeEvent.description}</p>}
          </div>
          <button onClick={() => setActiveEvent(null)}>Dismiss</button>
        </div>
      )}

      {waveSummaries.length > 0 && (
        <section className="wave-section">
          <header>
            <h3>Wave breakdown</h3>
            <p>Jump to a wave to zoom on its events.</p>
          </header>
          <div className="wave-grid">
            {waveSummaries.map((wave) => (
              <button key={wave.wave} onClick={() => focusWave(wave)}>
                <div>
                  <span>Wave</span>
                  <strong>{wave.wave}</strong>
                </div>
                <div>
                  <span>Events</span>
                  <strong>{wave.events.length}</strong>
                </div>
                <p>{formatDuration(wave.minMs, wave.maxMs)}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default CanvasTimeline;
