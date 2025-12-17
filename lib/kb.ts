import { openDB, type DBSchema } from "idb";

export type KBDoc = {
  name: string;
  mimeType: string;
  addedAt: number;
  numChunks: number;
};

export type KBChunk = {
  id?: number;
  docName: string;
  chunkIndex: number;
  text: string;
  embedding: Float32Array;
};

type StoredChunk = {
  id?: number;
  docName: string;
  chunkIndex: number;
  text: string;
  embedding: ArrayBuffer;
  dims: number;
};

interface KBDB extends DBSchema {
  docs: {
    key: string; // docName
    value: KBDoc;
  };
  chunks: {
    key: number;
    value: StoredChunk;
    indexes: { by_doc: string };
  };
}

const DB_NAME = "kb_v1";
const DB_VERSION = 1;

async function getDb() {
  return await openDB<KBDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const docs = db.createObjectStore("docs");
      void docs;
      const chunks = db.createObjectStore("chunks", { keyPath: "id", autoIncrement: true });
      chunks.createIndex("by_doc", "docName");
    },
  });
}

export function chunkText(text: string, opts?: { chunkSize?: number; overlap?: number }): string[] {
  const chunkSize = opts?.chunkSize ?? 1200;
  const overlap = opts?.overlap ?? 200;

  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + chunkSize);
    let slice = cleaned.slice(i, end);

    // Try to end on a paragraph boundary within last 200 chars.
    const backWindowStart = Math.max(0, slice.length - 200);
    const backWindow = slice.slice(backWindowStart);
    const paraBreak = backWindow.lastIndexOf("\n\n");
    if (paraBreak > 0 && end < cleaned.length) {
      slice = slice.slice(0, backWindowStart + paraBreak);
    }

    const finalSlice = slice.trim();
    if (finalSlice) chunks.push(finalSlice);
    if (end >= cleaned.length) break;
    i = Math.max(0, i + (finalSlice.length || chunkSize) - overlap);
  }
  return chunks;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function kbListDocs(): Promise<KBDoc[]> {
  const db = await getDb();
  return await db.getAll("docs");
}

export async function kbClearAll(): Promise<void> {
  const db = await getDb();
  await db.clear("chunks");
  await db.clear("docs");
}

export async function kbDeleteDoc(docName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["docs", "chunks"], "readwrite");
  await tx.objectStore("docs").delete(docName);
  const idx = tx.objectStore("chunks").index("by_doc");
  let cursor = await idx.openCursor(docName);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function kbAddDocument(params: {
  docName: string;
  mimeType: string;
  fullText: string;
  embed: (texts: string[]) => Promise<Float32Array[]>;
}): Promise<{ doc: KBDoc; chunksAdded: number }> {
  const db = await getDb();

  // Replace if exists.
  await kbDeleteDoc(params.docName);

  const texts = chunkText(params.fullText);
  if (texts.length === 0) {
    throw new Error("No extractable text found in the uploaded document.");
  }

  const embeddings = await params.embed(texts);
  if (embeddings.length !== texts.length) {
    throw new Error("Embedding count mismatch.");
  }

  const doc: KBDoc = {
    name: params.docName,
    mimeType: params.mimeType,
    addedAt: Date.now(),
    numChunks: texts.length,
  };

  const tx = db.transaction(["docs", "chunks"], "readwrite");
  await tx.objectStore("docs").put(doc, doc.name);

  const chunkStore = tx.objectStore("chunks");
  for (let i = 0; i < texts.length; i++) {
    const emb = embeddings[i]!;
    // Ensure we store a plain ArrayBuffer (not SharedArrayBuffer).
    const embCopy = Float32Array.from(emb);
    const stored: StoredChunk = {
      docName: doc.name,
      chunkIndex: i,
      text: texts[i]!,
      embedding: embCopy.buffer,
      dims: embCopy.length,
    };
    await chunkStore.add(stored);
  }

  await tx.done;
  return { doc, chunksAdded: texts.length };
}

export async function kbSearch(params: {
  query: string;
  topK?: number;
  embedQuery: (text: string) => Promise<Float32Array>;
}): Promise<Array<{ docName: string; chunkIndex: number; score: number; text: string }>> {
  const topK = params.topK ?? 4;
  const q = params.query.trim();
  if (!q) return [];

  const db = await getDb();
  const docsCount = await db.count("docs");
  if (docsCount === 0) return [];

  const qEmb = await params.embedQuery(q);
  const storedChunks = await db.getAll("chunks");

  const scored = storedChunks
    .map((c) => {
      const emb = new Float32Array(c.embedding);
      const score = cosineSimilarity(qEmb, emb);
      return { docName: c.docName, chunkIndex: c.chunkIndex, score, text: c.text };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

