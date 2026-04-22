/**
 * Task #921 — CRM call recording transcription.
 *
 * Fetches Twilio call recordings (with our credentials) and runs them through
 * OpenAI Whisper to produce a searchable transcript stored on the recording.
 * Designed to be invoked from the Twilio recording webhook in a fire-and-forget
 * fashion (the webhook returns 200 immediately and we do the work in the
 * background) and from a manual re-transcribe endpoint for retries/backfill.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { crmCallRecordings } from "@shared/schema";
import { openai, AI_MODEL_GPT5 } from "../ai/openaiClient";
import { logError, logInfo, logWarn } from "../utils/logger";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

const WHISPER_MODEL = "whisper-1";
const PROVIDER_NAME = "openai-whisper-1";
const ALLOWED_HOSTS = new Set(["api.twilio.com"]);

// Task #947 — only summarize transcripts that are long enough to benefit from
// a skim-friendly bullet summary. Short transcripts (e.g. voicemail-length
// callbacks) are easier to read in full.
const SUMMARY_MIN_CHARS = 600;
// Cap input size we send to the model. Whisper transcripts of long calls can
// be tens of KB; this still gives the model plenty of context.
const SUMMARY_MAX_CHARS = 16000;

export interface CallSummary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  nextSteps: string[];
}

const SUMMARY_SYSTEM_PROMPT = `You are an assistant that summarizes business phone call transcripts so a busy CRM user can skim the call in seconds.

Respond with a JSON object matching this EXACT structure:
{
  "summary": "string - 1-2 sentence overview of the call",
  "keyPoints": ["string - notable topic discussed"],
  "actionItems": ["string - concrete task or commitment made on the call"],
  "nextSteps": ["string - planned follow-up activity or scheduled future contact"]
}

Guidelines:
- Be concise; each bullet should be a short phrase, not a paragraph.
- Use 2-6 items per array; use an empty array if nothing applies.
- Refer to participants by role (caller, customer, rep) if names are unclear.
- Do not invent information that is not in the transcript.`;

export async function summarizeTranscript(transcript: string): Promise<CallSummary | null> {
  const trimmed = transcript.trim();
  if (!trimmed) return null;
  const input = trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: `Transcript:\n\n${input}` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<CallSummary>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      keyPoints: arr(parsed.keyPoints),
      actionItems: arr(parsed.actionItems),
      nextSteps: arr(parsed.nextSteps),
    };
  } catch (e) {
    logError(
      "callTranscription: summarization failed",
      {},
      e instanceof Error ? e : new Error(String(e)),
    );
    return null;
  }
}

async function fetchRecordingAudio(rawUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    logWarn("callTranscription: malformed recording url", { rawUrl });
    return null;
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    logWarn("callTranscription: host not allowed", { host: parsed.hostname });
    return null;
  }
  const isTwilio = parsed.hostname.toLowerCase() === "api.twilio.com";
  const targetUrl = parsed.pathname.endsWith(".mp3") ? parsed.toString() : `${parsed.toString()}.mp3`;

  const headers: Record<string, string> = {};
  if (isTwilio) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      logWarn("callTranscription: Twilio credentials missing");
      return null;
    }
    const basic = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  const res = await fetch(targetUrl, { headers });
  if (!res.ok) {
    logWarn("callTranscription: fetch failed", { status: res.status });
    return null;
  }
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  return { buffer, contentType };
}

export interface TranscribeResult {
  ok: boolean;
  transcript?: string;
  error?: string;
}

export async function transcribeCallRecording(recordingId: string): Promise<TranscribeResult> {
  const [rec] = await db
    .select()
    .from(crmCallRecordings)
    .where(eq(crmCallRecordings.id, recordingId))
    .limit(1);
  if (!rec) {
    return { ok: false, error: "recording not found" };
  }

  // Mark as processing to avoid concurrent re-runs.
  await db
    .update(crmCallRecordings)
    .set({ transcriptStatus: "PROCESSING", transcriptError: null })
    .where(eq(crmCallRecordings.id, recordingId));

  try {
    const audio = await fetchRecordingAudio(rec.recordingUrl);
    if (!audio) {
      const msg = "Failed to fetch recording audio";
      await db
        .update(crmCallRecordings)
        .set({ transcriptStatus: "FAILED", transcriptError: msg })
        .where(eq(crmCallRecordings.id, recordingId));
      return { ok: false, error: msg };
    }

    const ext = audio.contentType.includes("wav") ? "wav" : "mp3";
    const file = await (await import("openai")).toFile(audio.buffer, `call-${recordingId}.${ext}`, {
      type: audio.contentType,
    });

    const result = await openai.audio.transcriptions.create({
      file,
      model: WHISPER_MODEL,
    });

    const transcript = (result.text || "").trim();
    await db
      .update(crmCallRecordings)
      .set({
        transcript: transcript || null,
        transcriptStatus: transcript ? "COMPLETED" : "FAILED",
        transcriptProvider: PROVIDER_NAME,
        transcriptError: transcript ? null : "Empty transcript returned",
        transcribedAt: new Date(),
        // Reset any prior summary; will be re-generated below if the new
        // transcript is long enough.
        summary: null,
        summaryGeneratedAt: null,
      })
      .where(eq(crmCallRecordings.id, recordingId));

    logInfo("callTranscription: completed", {
      recordingId,
      length: transcript.length,
    });

    // Task #947 — generate an AI summary for long transcripts so users can
    // skim the call without reading the whole thing. Stored alongside the
    // transcript so we don't regenerate on every view.
    if (transcript.length >= SUMMARY_MIN_CHARS) {
      const summary = await summarizeTranscript(transcript);
      if (summary && (summary.summary || summary.keyPoints.length || summary.actionItems.length || summary.nextSteps.length)) {
        await db
          .update(crmCallRecordings)
          .set({ summary, summaryGeneratedAt: new Date() })
          .where(eq(crmCallRecordings.id, recordingId));
        logInfo("callTranscription: summarized", { recordingId });
      }
    }

    return { ok: true, transcript };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(crmCallRecordings)
      .set({ transcriptStatus: "FAILED", transcriptError: msg.slice(0, 500) })
      .where(eq(crmCallRecordings.id, recordingId));
    logError(
      "callTranscription: failed",
      { recordingId },
      e instanceof Error ? e : new Error(String(e)),
    );
    return { ok: false, error: msg };
  }
}

/**
 * Fire-and-forget wrapper used from the Twilio webhook. Errors are swallowed
 * so the caller can return 200 immediately to Twilio.
 */
export function queueCallTranscription(recordingId: string): void {
  setImmediate(() => {
    transcribeCallRecording(recordingId).catch((e) => {
      logError(
        "callTranscription: unhandled background error",
        { recordingId },
        e instanceof Error ? e : new Error(String(e)),
      );
    });
  });
}
