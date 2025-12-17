import { z } from "zod";

export type ToolSpec = {
  name: string;
  description: string;
  /**
   * Minimal args spec to show the LLM.
   * Keep this JSON-serializable.
   */
  argsSpec: Record<string, { type: string; description: string; required?: boolean }>;
};

type ToolDef<TArgs extends z.ZodTypeAny> = ToolSpec & {
  argsSchema: TArgs;
  execute: (args: z.infer<TArgs>) => Promise<unknown>;
};

const notesKey = "mcp_notes_v1";

function loadNotes(): Array<{ title: string; body: string; createdAtISO: string }> {
  try {
    const raw = localStorage.getItem(notesKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n) =>
        n &&
        typeof n === "object" &&
        typeof n.title === "string" &&
        typeof n.body === "string" &&
        typeof n.createdAtISO === "string",
    );
  } catch {
    return [];
  }
}

function saveNotes(notes: Array<{ title: string; body: string; createdAtISO: string }>) {
  localStorage.setItem(notesKey, JSON.stringify(notes));
}

function safeCalculate(expression: string): number {
  // Allow only a small, safe subset of characters.
  // Numbers, whitespace, and basic arithmetic operators.
  const ok = /^[0-9+\-*/().\s]+$/.test(expression);
  if (!ok) throw new Error("Expression contains unsupported characters.");
  const fn = new Function(`return (${expression});`);
  const result = fn();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number.");
  }
  return result;
}

export type AnyToolDef = ToolSpec & {
  argsSchema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<unknown>;
};

export const mcpTools: AnyToolDef[] = [
  {
    name: "get_time",
    description: "Get the user's local date/time (from the browser).",
    argsSpec: {},
    argsSchema: z.object({}).strict(),
    execute: async () => {
      return {
        nowISO: new Date().toISOString(),
        localeString: new Date().toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },
  {
    name: "calculate",
    description:
      "Evaluate a basic arithmetic expression (digits and + - * / ( ) .). No variables, no functions.",
    argsSpec: {
      expression: { type: "string", description: "Arithmetic expression, e.g. '(12.5*3)-4/2'", required: true },
    },
    argsSchema: z.object({ expression: z.string().min(1).max(200) }).strict(),
    execute: async (args) => {
      const { expression } = args as { expression: string };
      return { expression, result: safeCalculate(expression) };
    },
  },
  {
    name: "save_note",
    description: "Save a note locally in the browser (localStorage).",
    argsSpec: {
      title: { type: "string", description: "Short unique note title", required: true },
      body: { type: "string", description: "Note content", required: true },
    },
    argsSchema: z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(5000) }).strict(),
    execute: async (args) => {
      const { title, body } = args as { title: string; body: string };
      const notes = loadNotes();
      const existingIdx = notes.findIndex((n) => n.title.toLowerCase() === title.toLowerCase());
      const entry = { title, body, createdAtISO: new Date().toISOString() };
      if (existingIdx >= 0) notes[existingIdx] = entry;
      else notes.unshift(entry);
      saveNotes(notes);
      return { ok: true, saved: entry, totalNotes: notes.length };
    },
  },
  {
    name: "list_notes",
    description: "List note titles saved locally in the browser.",
    argsSpec: {},
    argsSchema: z.object({}).strict(),
    execute: async () => {
      const notes = loadNotes();
      return { totalNotes: notes.length, titles: notes.map((n) => n.title) };
    },
  },
  {
    name: "get_note",
    description: "Fetch a saved note by title (case-insensitive).",
    argsSpec: {
      title: { type: "string", description: "Title of the note to fetch", required: true },
    },
    argsSchema: z.object({ title: z.string().min(1).max(80) }).strict(),
    execute: async (args) => {
      const { title } = args as { title: string };
      const notes = loadNotes();
      const found = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
      if (!found) return { found: false, title };
      return { found: true, note: found };
    },
  },
];

export function getToolSpecs(): ToolSpec[] {
  return mcpTools.map(({ name, description, argsSpec }) => ({ name, description, argsSpec }));
}

export function getToolByName(name: string | null | undefined) {
  if (!name) return null;
  return mcpTools.find((t) => t.name === name) ?? null;
}

