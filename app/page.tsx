"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { MLCEngine } from "@mlc-ai/web-llm";
import { extractFirstJsonObject, safeJsonParse } from "@/lib/json";
import { getToolByName, getToolSpecs } from "@/lib/mcpTools";
import { kbAddDocument, kbClearAll, kbDeleteDoc, kbListDocs, kbSearch, type KBDoc } from "@/lib/kb";
import { createEnglishSpeechRecognizer, isSpeechRecognitionSupported, speakEnglish } from "@/lib/speech";

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: number;
};

const RouterDecisionSchema = z
  .object({
    english_text: z.string().default(""),
    tool: z.string().nullable().default(null),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

function newId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export default function Home() {
  const [modelId, setModelId] = useState<string>("Llama-3.2-1B-Instruct-q4f16_1-MLC");
  const [engineState, setEngineState] = useState<
    | { status: "idle" }
    | { status: "loading"; text: string }
    | { status: "ready" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const engineRef = useRef<MLCEngine | null>(null);

  const [embedModelId] = useState<string>("snowflake-arctic-embed-s-q0f32-MLC-b4");
  const [embedState, setEmbedState] = useState<
    | { status: "idle" }
    | { status: "loading"; text: string }
    | { status: "ready" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const embedEngineRef = useRef<MLCEngine | null>(null);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [voiceOutEnabled, setVoiceOutEnabled] = useState(true);

  const [voiceInStatus, setVoiceInStatus] = useState<"idle" | "listening">("idle");
  const voiceRecognizerRef = useRef<ReturnType<typeof createEnglishSpeechRecognizer> | null>(null);

  const toolSpecs = useMemo(() => getToolSpecs(), []);
  const canUseVoiceIn = useMemo(() => isSpeechRecognitionSupported(), []);

  const [kbDocs, setKbDocs] = useState<KBDoc[]>([]);
  const [kbStatus, setKbStatus] = useState<string>("");
  const [isIngesting, setIsIngesting] = useState(false);

  // Local-first chat history (simple localStorage persistence).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("chat_history_v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setMessages(
        parsed.filter(
          (m) =>
            m &&
            typeof m === "object" &&
            typeof m.id === "string" &&
            (m.role === "user" || m.role === "assistant" || m.role === "tool") &&
            typeof m.content === "string" &&
            typeof m.createdAt === "number",
        ),
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("chat_history_v1", JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    void (async () => {
      try {
        setKbDocs(await kbListDocs());
      } catch {
        // ignore
      }
    })();
  }, []);

  // Voice input setup.
  useEffect(() => {
    if (!canUseVoiceIn) return;
    if (voiceRecognizerRef.current) return;
    voiceRecognizerRef.current = createEnglishSpeechRecognizer({
      onText: (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
      onError: (message) => {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: `Voice input error: ${message}`,
            createdAt: Date.now(),
          },
        ]);
      },
      onStatus: setVoiceInStatus,
    });
  }, [canUseVoiceIn]);

  async function ensureEmbedEngineLoaded() {
    if (embedEngineRef.current) return;
    if (embedState.status === "loading") return;
    if (typeof window === "undefined") return;
    if (!("gpu" in navigator)) {
      setEmbedState({ status: "error", message: "WebGPU not detected (needed for local embeddings)." });
      return;
    }
    setEmbedState({ status: "loading", text: "Loading embedding model…" });
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = new webllm.MLCEngine({
        initProgressCallback: (p) => {
          const text = `${p.text}${p.progress ? ` (${Math.round(p.progress * 100)}%)` : ""}`;
          setEmbedState({ status: "loading", text });
        },
        appConfig: { ...webllm.prebuiltAppConfig, useIndexedDBCache: true },
      });
      await engine.reload(embedModelId);
      embedEngineRef.current = engine;
      setEmbedState({ status: "ready" });
    } catch (e) {
      setEmbedState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function embedTexts(texts: string[]): Promise<Float32Array[]> {
    await ensureEmbedEngineLoaded();
    const engine = embedEngineRef.current;
    if (!engine) throw new Error("Embedding model is not ready.");
    const res = await engine.embeddings.create({ input: texts, encoding_format: "float" });
    return res.data.map((d) => new Float32Array(d.embedding));
  }

  async function embedQuery(text: string): Promise<Float32Array> {
    const [v] = await embedTexts([text]);
    if (!v) throw new Error("Failed to embed query.");
    return v;
  }

  // Load WebLLM model (all inference stays in the browser; first run downloads model assets).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("gpu" in navigator)) {
        setEngineState({
          status: "error",
          message: "WebGPU not detected. This demo needs a WebGPU-capable browser (e.g. recent Chrome/Edge).",
        });
        return;
      }
      setEngineState({ status: "loading", text: "Loading in-browser model…" });
      try {
        const webllm = await import("@mlc-ai/web-llm");
        const engine = new webllm.MLCEngine({
          initProgressCallback: (p) => {
            if (cancelled) return;
            const text = `${p.text}${p.progress ? ` (${Math.round(p.progress * 100)}%)` : ""}`;
            setEngineState({ status: "loading", text });
          },
          appConfig: { ...webllm.prebuiltAppConfig, useIndexedDBCache: true },
        });
        await engine.reload(modelId);
        if (cancelled) return;
        engineRef.current = engine;
        setEngineState({ status: "ready" });
      } catch (e) {
        if (cancelled) return;
        setEngineState({
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  async function extractTextFromFile(file: File): Promise<string> {
    const name = file.name.toLowerCase();
    const mime = file.type || "";

    // PDF
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist");
      const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

      const data = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data }).promise;

      let out = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const strings = (content.items as Array<{ str?: unknown }>)
          .map((it) => (typeof it.str === "string" ? it.str : ""))
          .filter(Boolean);
        out += `\n\n[Page ${i}]\n` + strings.join(" ");
      }
      return out.trim();
    }

    // DOCX
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const data = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: data });
      return String(res.value || "").trim();
    }

    // Plain text-ish
    return (await file.text()).trim();
  }

  async function ingestFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsIngesting(true);
    setKbStatus("");
    try {
      await ensureEmbedEngineLoaded();
      for (const file of Array.from(files)) {
        const text = await extractTextFromFile(file);
        if (!text) {
          setKbStatus(`No text found in ${file.name}`);
          continue;
        }
        setKbStatus(`Indexing ${file.name}…`);
        await kbAddDocument({
          docName: file.name,
          mimeType: file.type || "application/octet-stream",
          fullText: text,
          embed: async (texts) => {
            // Batch embeddings to avoid huge single requests.
            const batchSize = 8;
            const out: Float32Array[] = [];
            for (let i = 0; i < texts.length; i += batchSize) {
              const batch = texts.slice(i, i + batchSize);
              const vecs = await embedTexts(batch);
              out.push(...vecs);
            }
            return out;
          },
        });
      }
      setKbDocs(await kbListDocs());
      setKbStatus("Done indexing.");
    } catch (e) {
      setKbStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setIsIngesting(false);
      setTimeout(() => setKbStatus(""), 4000);
    }
  }

  async function runAssistant(userText: string) {
    const engine = engineRef.current;
    if (!engine) {
      const msg = "Model is not ready yet.";
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: msg, createdAt: Date.now() }]);
      if (voiceOutEnabled) speakEnglish(msg);
      return;
    }

    // 1) Knowledge base retrieval (local RAG) – if we have docs and embedding model available.
    try {
      if (kbDocs.length > 0) {
        const hits = await kbSearch({
          query: userText,
          topK: 4,
          embedQuery,
        });
        const best = hits[0]?.score ?? 0;
        // A conservative threshold; tweak as needed.
        if (hits.length > 0 && best >= 0.22) {
          const context = hits
            .map((h, idx) => `[#${idx + 1}] ${h.docName} (chunk ${h.chunkIndex}, score ${h.score.toFixed(3)}):\n${h.text}`)
            .join("\n\n");

          const ragSystem = [
            "You are a local assistant with a user-provided document knowledge base.",
            "Answer ONLY using the provided CONTEXT. If the answer is not in the context, say you don't have it.",
            "Cite sources using [#] markers that match the context blocks.",
          ].join("\n");

          const ragReply = await engine.chat.completions.create({
            messages: [
              { role: "system", content: ragSystem },
              { role: "user", content: `QUESTION:\n${userText}\n\nCONTEXT:\n${context}` },
            ],
            temperature: 0.2,
          });

          const answer = ragReply.choices[0]?.message?.content?.trim() || "I couldn't answer from the uploaded documents.";
          setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: answer, createdAt: Date.now() }]);
          if (voiceOutEnabled) speakEnglish(answer);
          return;
        }
      }
    } catch {
      // If KB flow fails for any reason, fall back to tool routing.
    }

    const routerSystem = [
      "You are a LOCAL tool-router running fully in the browser.",
      "The user's input can be any language; first produce an English version of it.",
      "Then decide whether ONE tool from the list can help. If none apply, pick null.",
      "Return ONLY strict JSON (no markdown, no prose).",
      "",
      "JSON schema:",
      `{ "english_text": string, "tool": string | null, "args": object }`,
      "",
      "Tools (name, description, argsSpec):",
      JSON.stringify(toolSpecs, null, 2),
    ].join("\n");

    const routerReply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: routerSystem },
        { role: "user", content: userText },
      ],
      temperature: 0,
    });
    const raw = routerReply.choices[0]?.message?.content ?? "";
    const jsonText = extractFirstJsonObject(raw) ?? raw;
    const parsed = safeJsonParse<unknown>(jsonText);
    const decision = parsed.ok ? RouterDecisionSchema.safeParse(parsed.value) : null;

    if (!decision || !decision.success) {
      const msg = "I couldn't decide on a tool locally. No tool was executed.";
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: msg, createdAt: Date.now() }]);
      if (voiceOutEnabled) speakEnglish(msg);
      return;
    }

    const englishText = decision.data.english_text || userText;
    const tool = getToolByName(decision.data.tool);

    if (!tool) {
      const msg = "No tools are available for that request.";
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: msg, createdAt: Date.now() },
      ]);
      if (voiceOutEnabled) speakEnglish(msg);
      return;
    }

    let toolResult: unknown;
    try {
      const args = tool.argsSchema.parse(decision.data.args ?? {});
      toolResult = await tool.execute(args);
    } catch (e) {
      const msg = `Tool "${tool.name}" failed: ${e instanceof Error ? e.message : String(e)}`;
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: msg, createdAt: Date.now() }]);
      if (voiceOutEnabled) speakEnglish(msg);
      return;
    }

    const toolResultText = formatToolResult(toolResult);
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "tool", content: `tool:${tool.name}\n${toolResultText}`, createdAt: Date.now() },
    ]);

    const assistantSystem = [
      "You are a helpful assistant running locally in the browser.",
      "Use the tool result to answer the user. Be concise.",
      "If the tool result is JSON, you may summarize it, but do not invent extra facts.",
    ].join("\n");

    const finalReply = await engine.chat.completions.create({
      messages: [
        { role: "system", content: assistantSystem },
        { role: "user", content: englishText },
        { role: "assistant", content: `I executed tool "${tool.name}". Tool output:\n${toolResultText}` },
      ],
      temperature: 0.2,
    });

    const assistantText = finalReply.choices[0]?.message?.content?.trim() || `Tool "${tool.name}" executed.`;
    setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: assistantText, createdAt: Date.now() }]);
    if (voiceOutEnabled) speakEnglish(assistantText);
  }

  async function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text, createdAt: Date.now() }]);
    setIsBusy(true);
    try {
      await runAssistant(text);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <h1 className="text-xl font-semibold">Local-first Browser AI (no server inference)</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Chat or voice → English text → local LLM routes to a local “MCP-like” tool → tool runs → voice output.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Model</span>
              <select
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={engineState.status === "loading" || isBusy}
              >
                <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">Llama 3.2 1B (q4f16_1)</option>
                <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">Llama 3.2 1B (q4f32_1)</option>
                <option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">Llama 3.2 3B (q4f16_1)</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={voiceOutEnabled}
                onChange={(e) => setVoiceOutEnabled(e.target.checked)}
              />
              <span>Voice output</span>
            </label>

            <div className="ml-auto text-sm">
              {engineState.status === "ready" && <span className="text-green-700 dark:text-green-400">Model ready</span>}
              {engineState.status === "loading" && (
                <span className="text-zinc-600 dark:text-zinc-400">{engineState.text}</span>
              )}
              {engineState.status === "error" && (
                <span className="text-red-700 dark:text-red-400">{engineState.message}</span>
              )}
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 py-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="text-sm font-medium">Knowledge base (local)</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  Upload PDFs / DOCX / text files. Stored + searched locally in IndexedDB.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  disabled={isIngesting || isBusy}
                  onChange={(e) => void ingestFiles(e.target.files)}
                  className="text-sm"
                />
                <button
                  type="button"
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
                  disabled={isIngesting || kbDocs.length === 0}
                  onClick={() => {
                    void (async () => {
                      setKbStatus("Clearing…");
                      await kbClearAll();
                      setKbDocs(await kbListDocs());
                      setKbStatus("Cleared.");
                      setTimeout(() => setKbStatus(""), 2000);
                    })();
                  }}
                >
                  Clear KB
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <div>
                Embeddings:{" "}
                {embedState.status === "ready"
                  ? "ready"
                  : embedState.status === "loading"
                    ? embedState.text
                    : embedState.status === "error"
                      ? `error: ${embedState.message}`
                      : "idle (loads on first upload/search)"}
              </div>
              {kbStatus ? <div className="text-zinc-800 dark:text-zinc-200">{kbStatus}</div> : null}
            </div>

            <div className="mt-3 grid gap-2">
              {kbDocs.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No documents uploaded yet.</div>
              ) : (
                kbDocs.map((d) => (
                  <div
                    key={d.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">
                        {d.numChunks} chunks • {d.mimeType || "unknown type"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
                      disabled={isIngesting}
                      onClick={() => {
                        void (async () => {
                          setKbStatus(`Removing ${d.name}…`);
                          await kbDeleteDoc(d.name);
                          setKbDocs(await kbListDocs());
                          setKbStatus("");
                        })();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="flex-1 space-y-3 overflow-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            {messages.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Try: “What time is it?”, “Calculate (12.5*3)-4/2”, “Save a note titled Shopping with body eggs and
                milk”, “List my notes”.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="flex">
                  <div
                    className={[
                      "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-6",
                      m.role === "user"
                        ? "ml-auto bg-blue-600 text-white"
                        : m.role === "tool"
                          ? "mr-auto bg-zinc-100 font-mono text-[12px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                          : "mr-auto bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50",
                    ].join(" ")}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
                disabled={!canUseVoiceIn || isBusy || engineState.status !== "ready"}
                onClick={() => {
                  const r = voiceRecognizerRef.current;
                  if (!r) return;
                  if (voiceInStatus === "listening") r.stop();
                  else r.start();
                }}
                title={canUseVoiceIn ? "Voice input" : "Voice input not supported in this browser"}
              >
                {voiceInStatus === "listening" ? "Stop mic" : "Mic"}
              </button>

              <input
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                placeholder="Type a message…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
                disabled={isBusy || engineState.status !== "ready"}
              />

              <button
                type="button"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => void onSend()}
                disabled={isBusy || engineState.status !== "ready" || !input.trim()}
              >
                Send
              </button>
            </div>

            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Tools available: {toolSpecs.map((t) => t.name).join(", ")}. Everything runs locally after the model is
              downloaded/cached.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
