import { useCallback, useEffect, useRef, useState } from "react";
import { correctMedicalTerms } from "../lib/medicalDictionary";

/**
 * Voice dictation hook using MedASR (google/medasr) via the backend proxy.
 *
 * Flow:
 *   1. User clicks mic → browser requests microphone via MediaRecorder API
 *   2. Audio is captured as WebM/Opus chunks in the browser
 *   3. On stop, the accumulated audio blob is POSTed to `/voice/transcribe`
 *   4. Backend proxies the audio to medasr-server:5001 for medical-grade ASR
 *   5. Returned transcript is run through the local medical dictionary corrections
 *   6. Corrected text is passed to `onFinalText` callback for insertion into the editor
 *
 * ⚠️ Does NOT use the Web Speech API — that API has poor medical term accuracy
 *   and requires an internet connection. MedASR is trained on clinical/radiology
 *   speech and works offline after model download.
 */

// Spoken punctuation/structure commands → literal text, applied before medical-term correction.
const VOICE_COMMANDS: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, "\n\n"],
  [/\bnew line\b/gi, "\n"],
  [/\bperiod\b/gi, "."],
  [/\bfull stop\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bcolon\b/gi, ":"],
  [/\bsemicolon\b/gi, ";"],
  [/\bopen paren(thesis)?\b/gi, "("],
  [/\bclose paren(thesis)?\b/gi, ")"],
];

function applyVoiceCommands(text: string): string {
  let result = text;
  for (const [pattern, replacement] of VOICE_COMMANDS) {
    result = result.replace(pattern, replacement);
  }
  // Tidy up spacing left behind by punctuation substitution (e.g. "lungs clear ." -> "lungs clear.")
  return result.replace(/\s+([.,:;)])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** Runs a transcript through voice-command expansion then the medical term dictionary. */
export function processDictationTranscript(raw: string): string {
  return correctMedicalTerms(applyVoiceCommands(raw));
}

export interface UseVoiceDictationResult {
  /** Whether the browser supports MediaRecorder (virtually all modern browsers). */
  isSupported: boolean;
  /** Whether we're currently recording from the microphone. */
  isListening: boolean;
  /** Whether we're currently sending audio to MedASR for transcription. */
  isTranscribing: boolean;
  /** Status text shown to the user (e.g. "Recording...", "Transcribing..."). */
  statusText: string;
  /** Start recording from the microphone. */
  start: () => void;
  /** Stop recording and trigger transcription. */
  stop: () => void;
  /** Last error message, or null. */
  error: string | null;
}

/**
 * Records audio via MediaRecorder and sends it to the backend `/voice/transcribe`
 * endpoint, which proxies to the MedASR server for medical-grade speech recognition.
 *
 * @param onFinalText - Called with the corrected transcript after successful transcription.
 * @param radiologyMode - If true, uses the /radiology endpoint for MedGemma structuring.
 */
export function useVoiceDictation(
  onFinalText: (text: string) => void,
  radiologyMode = false,
): UseVoiceDictationResult {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const onFinalTextRef = useRef(onFinalText);
  onFinalTextRef.current = onFinalText;

  const isSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    setStatusText("Transcribing with MedASR...");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const endpoint = radiologyMode ? "/api/voice/transcribe/radiology" : "/api/voice/transcribe";

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        credentials: "include", // session auth
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errData.error || `Transcription failed (${response.status})`);
      }

      const result = await response.json();

      // Use raw_transcript from MedASR, then apply local corrections
      const rawText = result.raw_transcript || result.corrected_transcript || "";
      if (!rawText.trim()) {
        setStatusText("No speech detected");
        setTimeout(() => setStatusText(""), 2000);
        return;
      }

      const correctedText = processDictationTranscript(rawText);
      onFinalTextRef.current(correctedText);

      setStatusText(
        `✓ Transcribed (${Math.round(result.confidence * 100)}% confidence, ${Math.round(result.processing_time_ms)}ms)`,
      );
      setTimeout(() => setStatusText(""), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setError(msg);
      setStatusText("");
    } finally {
      setIsTranscribing(false);
    }
  }, [radiologyMode]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("Microphone access is not available in this browser.");
      return;
    }

    setError(null);
    setStatusText("Requesting microphone...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,       // MedASR expects 16 kHz
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      // Prefer opus codec in WebM container (best quality for speech at low bitrate)
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg;codecs=opus";

      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Stop all microphone tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (audioBlob.size < 100) {
          setError("Recording too short — please speak longer.");
          setIsListening(false);
          return;
        }

        // Send to MedASR for transcription
        transcribeAudio(audioBlob);
        setIsListening(false);
      };

      recorder.onerror = () => {
        setError("Microphone recording error");
        setIsListening(false);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // collect data every second
      setIsListening(true);
      setStatusText("Recording... Click again to stop");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(`Microphone error: ${msg}`);
      setStatusText("");
    }
  }, [isSupported, transcribeAudio]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setStatusText("Processing...");
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { isSupported, isListening, isTranscribing, statusText, start, stop, error };
}
