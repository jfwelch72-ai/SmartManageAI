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
import { openai } from "../ai/openaiClient";
import { logError, logInfo, logWarn } from "../utils/logger";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

const WHISPER_MODEL = "whisper-1";
const PROVIDER_NAME = "openai-whisper-1";
const ALLOWED_HOSTS = new Set(["api.twilio.com"]);

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
      })
      .where(eq(crmCallRecordings.id, recordingId));

    logInfo("callTranscription: completed", {
      recordingId,
      length: transcript.length,
    });
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
