/**
 * Reproductor de TTS en streaming para el modo elevenlabs.
 *
 * Camino rápido (MSE): un MediaSource 'audio/mpeg' al que se le anexan los
 * frames MP3 según llegan del proxy /api/tts/stream. El audio empieza a
 * sonar con los primeros frames, mientras OpenAI sigue generando texto y
 * ElevenLabs sigue sintetizando los fragmentos siguientes.
 *
 * Fallback (sin MSE — p. ej. Safari/iOS): cada fragmento de texto se
 * descarga completo y se reproduce en cola. Sigue siendo mucho más rápido
 * que el pipeline antiguo porque el primer fragmento es una frase corta.
 *
 * Los fetch de fragmentos se lanzan en paralelo (máx. razonable) pero los
 * bytes se anexan estrictamente en orden. cancel() aborta todo: fetches,
 * buffers y reproducción — el audio de una generación cancelada jamás suena.
 */

export interface TtsStreamCallbacks {
  onFirstAudioByte(): void;
  onPlaying(): void;
  onEnded(): void;
  onError(message: string): void;
}

interface ChunkEntry {
  buffers: Uint8Array[];
  done: boolean;
  failed: boolean;
}

export function mseSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported("audio/mpeg")
  );
}

export class TtsStreamSession {
  private mode: "mse" | "blob";
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private entries: ChunkEntry[] = [];
  private appendIndex = 0;
  private appendOffset = 0;
  private textEnded = false;
  private cancelled = false;
  private firstByteSeen = false;
  private playingSeen = false;
  private endedSeen = false;
  private aborters = new Set<AbortController>();
  private blobUrls: string[] = [];
  private blobPlayIndex = 0;
  private blobBusy = false;
  private playTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly callbacks: TtsStreamCallbacks,
    private readonly startBufferMs: number,
  ) {
    this.mode = mseSupported() ? "mse" : "blob";
  }

  get transportMode(): "mse" | "blob" {
    return this.mode;
  }

  begin(): void {
    this.audio.onended = null;
    this.audio.onplaying = () => {
      if (!this.playingSeen && !this.cancelled) {
        this.playingSeen = true;
        this.callbacks.onPlaying();
      }
    };

    if (this.mode === "mse") {
      const mediaSource = new MediaSource();
      this.mediaSource = mediaSource;
      this.objectUrl = URL.createObjectURL(mediaSource);
      this.audio.srcObject = null;
      this.audio.src = this.objectUrl;
      mediaSource.addEventListener("sourceopen", () => {
        if (this.cancelled || this.sourceBuffer) return;
        try {
          this.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
          this.sourceBuffer.addEventListener("updateend", () => this.pump());
          this.pump();
        } catch {
          this.callbacks.onError("El navegador rechazó el buffer de audio en streaming.");
        }
      });
      this.audio.onended = () => this.maybeEnded();
    } else {
      this.audio.onended = () => {
        this.blobBusy = false;
        this.playNextBlob();
        this.maybeEnded();
      };
    }
  }

  /** Sintetiza un fragmento de texto. Los bytes se anexan en orden estricto. */
  enqueueText(text: string): void {
    if (this.cancelled) return;
    const index = this.entries.length;
    const entry: ChunkEntry = { buffers: [], done: false, failed: false };
    this.entries.push(entry);

    const aborter = new AbortController();
    this.aborters.add(aborter);

    void (async () => {
      try {
        const response = await fetch("/api/tts/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: aborter.signal,
        });
        if (!response.ok || !response.body) {
          entry.failed = true;
          entry.done = true;
          if (!this.cancelled) {
            const body = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            this.callbacks.onError(body?.error?.message ?? "La síntesis de voz falló.");
          }
          return;
        }
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (this.cancelled) {
            void reader.cancel().catch(() => {});
            return;
          }
          if (value && value.byteLength > 0) {
            entry.buffers.push(value);
            if (!this.firstByteSeen) {
              this.firstByteSeen = true;
              this.callbacks.onFirstAudioByte();
            }
            if (this.mode === "mse") this.pump();
          }
        }
        entry.done = true;
        if (this.mode === "mse") this.pump();
        else void this.settleBlobEntry(index);
      } catch (error) {
        entry.failed = true;
        entry.done = true;
        if (!this.cancelled && (error as DOMException)?.name !== "AbortError") {
          this.callbacks.onError("La síntesis de voz falló.");
        }
        if (this.mode === "mse") this.pump();
      } finally {
        this.aborters.delete(aborter);
      }
    })();
  }

  endOfText(): void {
    this.textEnded = true;
    if (this.mode === "mse") this.pump();
    else this.maybeEnded();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const aborter of this.aborters) aborter.abort();
    this.aborters.clear();
    if (this.playTimer) clearTimeout(this.playTimer);
    try {
      this.audio.pause();
    } catch {
      // sin reproducción activa
    }
    this.audio.onplaying = null;
    this.audio.onended = null;
    if (this.mode === "mse") {
      try {
        if (this.sourceBuffer && this.mediaSource?.readyState === "open") {
          this.sourceBuffer.abort();
        }
      } catch {
        // buffer ya cerrado
      }
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    this.entries = [];
  }

  // ── MSE: anexado en orden ────────────────────────────────────────────

  private pump(): void {
    if (this.cancelled || this.mode !== "mse") return;
    const sourceBuffer = this.sourceBuffer;
    if (!sourceBuffer || sourceBuffer.updating) return;

    const entry = this.entries[this.appendIndex];
    if (!entry) {
      this.finishIfDrained();
      return;
    }
    if (entry.failed) {
      this.appendIndex += 1;
      this.appendOffset = 0;
      this.pump();
      return;
    }
    if (this.appendOffset < entry.buffers.length) {
      const piece = entry.buffers[this.appendOffset];
      this.appendOffset += 1;
      try {
        sourceBuffer.appendBuffer(piece as BufferSource);
        this.schedulePlay();
      } catch {
        this.callbacks.onError("El navegador rechazó un fragmento de audio.");
      }
      return;
    }
    if (entry.done) {
      this.appendIndex += 1;
      this.appendOffset = 0;
      this.pump();
      return;
    }
    // Fragmento aún en vuelo: pump() se re-dispara al llegar más bytes.
    this.finishIfDrained();
  }

  private finishIfDrained(): void {
    if (!this.textEnded || this.cancelled) return;
    const allDone = this.entries.every((entry) => entry.done);
    const allAppended = this.appendIndex >= this.entries.length;
    if (allDone && allAppended && this.mediaSource?.readyState === "open" && !this.sourceBuffer?.updating) {
      try {
        this.mediaSource.endOfStream();
      } catch {
        // ya cerrado
      }
    }
  }

  private schedulePlay(): void {
    if (this.playTimer || this.playingSeen || this.cancelled) return;
    this.playTimer = setTimeout(() => {
      this.playTimer = null;
      if (this.cancelled) return;
      void this.audio.play().catch(() => {
        this.callbacks.onError("autoplay_blocked");
      });
    }, this.startBufferMs);
  }

  private maybeEnded(): void {
    if (this.endedSeen || this.cancelled || !this.textEnded) return;
    const allDone = this.entries.every((entry) => entry.done);
    if (!allDone) return;
    if (this.mode === "blob" && this.blobPlayIndex < this.blobUrls.length) return;
    if (this.mode === "mse" && !this.audio.ended) return;
    this.endedSeen = true;
    this.callbacks.onEnded();
  }

  // ── Fallback por cola de blobs ───────────────────────────────────────

  private async settleBlobEntry(index: number): Promise<void> {
    const entry = this.entries[index];
    if (!entry || entry.failed || this.cancelled) return;
    const blob = new Blob(entry.buffers as BlobPart[], { type: "audio/mpeg" });
    this.blobUrls[index] = URL.createObjectURL(blob);
    this.playNextBlob();
  }

  private playNextBlob(): void {
    if (this.cancelled || this.blobBusy) return;
    // Salta entradas fallidas ya resueltas.
    while (
      this.blobPlayIndex < this.entries.length &&
      this.entries[this.blobPlayIndex]?.failed &&
      this.entries[this.blobPlayIndex]?.done
    ) {
      this.blobPlayIndex += 1;
    }
    const url = this.blobUrls[this.blobPlayIndex];
    if (!url) {
      this.maybeEnded();
      return;
    }
    this.blobBusy = true;
    this.blobPlayIndex += 1;
    this.audio.srcObject = null;
    this.audio.src = url;
    void this.audio.play().catch(() => {
      this.callbacks.onError("autoplay_blocked");
    });
  }
}
