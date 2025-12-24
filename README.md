# Timeline dragger component (irregular intervals)

This repo contains a reusable React component to select a **time range** on a horizontal timeline, where the “steps” are **not uniform** (random/irregular intervals).

## What you get

- **Two-thumb range selection**: drag start/end handles to select any time between them
- **Irregular steps**: snaps to a provided list of time points (e.g. `[0, 7, 12, 29, 45]`)
- **Keyboard support**: focus a thumb and use arrow keys to move between steps

## Component

The component lives at `src/components/TimelineRangeDragger.tsx`.

### Usage (snap to random intervals)

```tsx
import * as React from "react";
import { TimelineRangeDragger, type TimelinePoint } from "./src";

const points: TimelinePoint[] = [
  { value: 0, label: "00:00" },
  { value: 7, label: "00:07" },
  { value: 12, label: "00:12" },
  { value: 29, label: "00:29" },
  { value: 45, label: "00:45" },
  { value: 90, label: "01:30" },
];

export function Example() {
  const [range, setRange] = React.useState<readonly [number, number]>([7, 45]);

  return (
    <div style={{ maxWidth: 640 }}>
      <TimelineRangeDragger
        points={points}
        value={range}
        onChange={setRange}
        snapToPoints={true}
        showTicks={true}
        formatValue={(v) => `${v}s`}
      />
    </div>
  );
}
```

### Continuous mode (optional)

If you want to allow **any** value between min/max (not only the irregular steps), set:

```tsx
<TimelineRangeDragger snapToPoints={false} />
```

