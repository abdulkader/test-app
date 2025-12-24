import * as React from "react";

export type TimelinePoint = {
  /**
   * Numeric time value (e.g. epoch ms, seconds, minutes-from-start).
   * Must be unique and sortable.
   */
  value: number;
  /** Optional label used for accessibility / display */
  label?: string;
};

export type TimelineRangeValue = readonly [start: number, end: number];

type ActiveThumb = "start" | "end";

export type TimelineRangeDraggerProps = {
  /**
   * Irregular/random time steps.
   * Provide the allowed timestamps you want to snap to (e.g. [0, 7, 12, 29, 45]).
   */
  points: readonly TimelinePoint[];

  /** Controlled value: [startValue, endValue] */
  value: TimelineRangeValue;
  onChange: (next: TimelineRangeValue) => void;

  /**
   * When true, dragging/keyboard movement snaps to `points` (recommended for random intervals).
   * When false, value can be any number between min(points) and max(points).
   */
  snapToPoints?: boolean;

  /**
   * Show tick marks for each point (can be many; consider turning off for large lists).
   */
  showTicks?: boolean;

  /** Disable interaction */
  disabled?: boolean;

  /** Optional formatting for the displayed value */
  formatValue?: (value: number) => string;

  /** Optional className/style for the outer container */
  className?: string;
  style?: React.CSSProperties;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function sortUniquePoints(points: readonly TimelinePoint[]) {
  const map = new Map<number, TimelinePoint>();
  for (const p of points) map.set(p.value, p);
  return [...map.values()].sort((a, b) => a.value - b.value);
}

function nearestPointValue(sorted: readonly TimelinePoint[], value: number) {
  if (sorted.length === 0) return value;
  // Binary search for nearest by numeric value
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const mv = sorted[mid]!.value;
    if (mv === value) return mv;
    if (mv < value) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is first > value; hi is last < value
  const right = sorted[clamp(lo, 0, sorted.length - 1)]!.value;
  const left = sorted[clamp(hi, 0, sorted.length - 1)]!.value;
  return Math.abs(right - value) < Math.abs(value - left) ? right : left;
}

function nextPointValue(sorted: readonly TimelinePoint[], current: number, dir: -1 | 1) {
  if (sorted.length === 0) return current;
  // Find insertion index
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.value < current) lo = mid + 1;
    else hi = mid;
  }
  // lo is first >= current
  const idx =
    dir === 1
      ? (sorted[lo]?.value === current ? lo + 1 : lo)
      : (sorted[lo]?.value === current ? lo - 1 : lo - 1);
  const clamped = clamp(idx, 0, sorted.length - 1);
  return sorted[clamped]!.value;
}

export function TimelineRangeDragger({
  points,
  value,
  onChange,
  snapToPoints = true,
  showTicks = true,
  disabled = false,
  formatValue,
  className,
  style,
}: TimelineRangeDraggerProps) {
  const sorted = React.useMemo(() => sortUniquePoints(points), [points]);
  const min = sorted[0]?.value ?? 0;
  const max = sorted[sorted.length - 1]?.value ?? 100;
  const range = Math.max(1, max - min);

  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const activeRef = React.useRef<ActiveThumb | null>(null);

  const toRatio = React.useCallback(
    (v: number) => clamp((v - min) / range, 0, 1),
    [min, range],
  );

  const fromRatio = React.useCallback(
    (r: number) => min + clamp(r, 0, 1) * range,
    [min, range],
  );

  const coerceValue = React.useCallback(
    (v: number) => {
      const clamped = clamp(v, min, max);
      return snapToPoints ? nearestPointValue(sorted, clamped) : clamped;
    },
    [min, max, snapToPoints, sorted],
  );

  const commit = React.useCallback(
    (nextStart: number, nextEnd: number) => {
      let s = coerceValue(nextStart);
      let e = coerceValue(nextEnd);
      if (s > e) [s, e] = [e, s];
      onChange([s, e]);
    },
    [coerceValue, onChange],
  );

  const getClientRatio = React.useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width || 1);
    return x / (rect.width || 1);
  }, []);

  const onPointerDownTrack = (e: React.PointerEvent) => {
    if (disabled) return;
    // Clicking the track moves the nearest thumb
    const r = getClientRatio(e.clientX);
    const t = fromRatio(r);
    const [s, en] = value;
    const dStart = Math.abs(t - s);
    const dEnd = Math.abs(t - en);
    const which: ActiveThumb = dStart <= dEnd ? "start" : "end";
    activeRef.current = which;
    if (which === "start") commit(t, en);
    else commit(s, t);
  };

  const onPointerDownThumb = (which: ActiveThumb) => (e: React.PointerEvent) => {
    if (disabled) return;
    activeRef.current = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (disabled) return;
    const which = activeRef.current;
    if (!which) return;
    if ((e.buttons & 1) !== 1) return;
    const r = getClientRatio(e.clientX);
    const t = fromRatio(r);
    const [s, en] = value;
    if (which === "start") commit(t, en);
    else commit(s, t);
  };

  const onPointerUp = () => {
    activeRef.current = null;
  };

  const onKeyDownThumb = (which: ActiveThumb) => (e: React.KeyboardEvent) => {
    if (disabled) return;
    const key = e.key;
    const [s, en] = value;
    const current = which === "start" ? s : en;
    const dir: -1 | 1 | 0 =
      key === "ArrowLeft" || key === "ArrowDown" ? -1 : key === "ArrowRight" || key === "ArrowUp" ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();

    const next =
      snapToPoints && sorted.length > 0
        ? nextPointValue(sorted, current, dir)
        : current + dir * (range * 0.01); // ~1% step when continuous

    if (which === "start") commit(next, en);
    else commit(s, next);
  };

  const startRatio = toRatio(value[0]);
  const endRatio = toRatio(value[1]);
  const left = Math.min(startRatio, endRatio);
  const right = Math.max(startRatio, endRatio);

  const fmt = React.useCallback(
    (v: number) => (formatValue ? formatValue(v) : String(v)),
    [formatValue],
  );

  const ticks = React.useMemo(() => {
    if (!showTicks || sorted.length === 0) return [];
    return sorted.map((p) => ({
      value: p.value,
      label: p.label,
      ratio: toRatio(p.value),
    }));
  }, [showTicks, sorted, toRatio]);

  const styles: Record<string, React.CSSProperties> = {
    root: {
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
      userSelect: "none",
      width: "100%",
      opacity: disabled ? 0.6 : 1,
      pointerEvents: disabled ? "none" : "auto",
      ...style,
    },
    header: { display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontSize: 12 },
    trackWrap: { position: "relative", padding: "14px 0" },
    track: {
      position: "relative",
      height: 6,
      borderRadius: 999,
      background: "#E5E7EB",
      outline: "none",
    },
    range: {
      position: "absolute",
      height: 6,
      borderRadius: 999,
      background: "#2563EB",
      left: `${left * 100}%`,
      width: `${Math.max(0, (right - left) * 100)}%`,
      top: 0,
    },
    thumb: {
      position: "absolute",
      top: "50%",
      width: 18,
      height: 18,
      borderRadius: 999,
      background: "#FFFFFF",
      border: "2px solid #2563EB",
      transform: "translate(-50%, -50%)",
      boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
      touchAction: "none",
    },
    tick: {
      position: "absolute",
      top: "50%",
      width: 2,
      height: 10,
      transform: "translate(-50%, -50%)",
      background: "#9CA3AF",
      opacity: 0.8,
    },
  };

  return (
    <div className={className} style={styles.root}>
      <div style={styles.header}>
        <div>
          <strong>Start:</strong> {fmt(value[0])}
        </div>
        <div>
          <strong>End:</strong> {fmt(value[1])}
        </div>
      </div>

      <div style={styles.trackWrap}>
        <div
          ref={trackRef}
          style={styles.track}
          role="presentation"
          onPointerDown={onPointerDownTrack}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div style={styles.range} />

          {ticks.map((t) => (
            <div
              key={t.value}
              style={{
                ...styles.tick,
                left: `${t.ratio * 100}%`,
              }}
              aria-hidden="true"
              title={t.label ?? fmt(t.value)}
            />
          ))}

          <div
            style={{ ...styles.thumb, left: `${startRatio * 100}%` }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Start"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value[0]}
            aria-valuetext={fmt(value[0])}
            onPointerDown={onPointerDownThumb("start")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDownThumb("start")}
          />

          <div
            style={{ ...styles.thumb, left: `${endRatio * 100}%` }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="End"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value[1]}
            aria-valuetext={fmt(value[1])}
            onPointerDown={onPointerDownThumb("end")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDownThumb("end")}
          />
        </div>
      </div>
    </div>
  );
}

