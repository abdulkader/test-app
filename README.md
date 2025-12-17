# Local-first Browser AI (Next.js)

This is a **browser-only** AI app:

- **Chat + mic input** (speech → text)
- **Local LLM routing** to “MCP-like” tools (no server inference)
- **Local knowledge base**: upload **PDF / DOCX / text** files, index in-browser, then answer questions from your documents
- **Voice output** (text-to-speech)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Notes

- **First run downloads models** (cached in IndexedDB). After that it’s local-first.
- **WebGPU required** for WebLLM (Chrome/Edge recommended).
- **Voice input** depends on browser SpeechRecognition support.
