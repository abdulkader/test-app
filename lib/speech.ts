export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export type SpeechRecognitionController = {
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionErrorEventLike = { error?: unknown };
type SpeechRecognitionResultLike = { transcript?: unknown };
type SpeechRecognitionResultsLike = ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
type SpeechRecognitionEventLike = { results?: SpeechRecognitionResultsLike };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((evt: SpeechRecognitionErrorEventLike) => void);
  onresult: null | ((evt: SpeechRecognitionEventLike) => void);
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function createEnglishSpeechRecognizer(opts: {
  onText: (text: string) => void;
  onError: (message: string) => void;
  onStatus: (status: "idle" | "listening") => void;
}): SpeechRecognitionController | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;

  const recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => opts.onStatus("listening");
  recognition.onend = () => opts.onStatus("idle");
  recognition.onerror = (evt) =>
    opts.onError(evt && "error" in evt && evt.error !== undefined ? String(evt.error) : "Speech recognition error");
  recognition.onresult = (evt) => {
    const text = evt?.results?.[0]?.[0]?.transcript;
    if (typeof text === "string" && text.trim()) opts.onText(text.trim());
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}

export function speakEnglish(text: string) {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

