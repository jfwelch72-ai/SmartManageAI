// prompt-injection-guard: chat attachment processor — every extracted text/transcript block
// is wrapped with quarantineUserText so a hostile filename or document body cannot escape
// the user-message envelope. Audio transcripts come from OpenAI Whisper (no instruction
// following). Image/document text routes through extractDocumentContent which is the same
// path the AI Estimator main draft flow uses.
import { z } from "zod";
import { logError, logInfo, logWarn } from "../../utils/logger";
import { extractDocumentContent } from "../../ai/documentExtractor";
import { openai } from "../../ai/openaiClient";
import { quarantineUserText } from "../../ai/promptInjectionGuard";
import { ObjectPermission } from "../../objectAcl";

export const chatAttachmentInputSchema = z.object({
  kind: z.enum(["image", "document", "audio"]),
  /** Normalized GCS path returned by /api/objects/confirm — `/objects/<id>`. */
  objectPath: z.string().min(1).startsWith("/objects/"),
  contentType: z.string().min(1).max(200),
  fileName: z.string().min(1).max(300),
  sizeBytes: z.number().int().min(0).max(500 * 1024 * 1024),
});
export type ChatAttachmentInput = z.infer<typeof chatAttachmentInputSchema>;

export interface ChatAttachmentStored extends ChatAttachmentInput {
  /** Whisper transcript text — only for audio. */
  transcript?: string;
  /** Extracted text snippet — for documents and (best-effort) images. */
  extractedText?: string;
}

const WHISPER_MODEL = "whisper-1";
const MAX_DOC_CHARS = 4000;
const MAX_IMAGE_OCR_CHARS = 1500;
const MAX_PROMPT_BLOCK_CHARS = 6000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI Whisper limit

interface DownloadedObject {
  buffer: Buffer;
  contentType: string;
}

/**
 * Authorize that the requesting user/org may READ the object behind a
 * normalized `/objects/<id>` path. Returns the resolved GCS File on success
 * or `null` on either lookup failure or ACL denial. This is the single
 * choke-point that prevents IDOR-style cross-tenant reads via a guessed
 * objectPath in the chat attachment payload.
 */
async function authorizeAndResolveObject(
  objectPath: string,
  userId: string,
  organizationId: string,
): Promise<import("@google-cloud/storage").File | null> {
  try {
    const { ObjectStorageService } = await import("../../objectStorage");
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(objectPath);
    const allowed = await svc.canAccessObjectEntity({
      userId,
      userOrganizationId: organizationId,
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    if (!allowed) {
      logWarn("[chatAttachments] attachment denied by ACL — cross-tenant or unauthorized read attempt", {
        objectPath,
        userId,
        organizationId,
      });
      return null;
    }
    return file;
  } catch (err) {
    logWarn("[chatAttachments] authorizeAndResolveObject failed", {
      objectPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Internal: download the buffer for an already-authorized GCS file. */
async function downloadAuthorizedFile(
  file: import("@google-cloud/storage").File,
): Promise<DownloadedObject | null> {
  try {
    const [meta] = await file.getMetadata();
    const [buf] = await file.download();
    return {
      buffer: buf,
      contentType: typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream",
    };
  } catch (err) {
    logWarn("[chatAttachments] downloadAuthorizedFile failed", {
      name: file.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function transcribeAudio(
  att: ChatAttachmentInput,
  file: import("@google-cloud/storage").File,
): Promise<string | null> {
  const dl = await downloadAuthorizedFile(file);
  if (!dl) return null;
  if (dl.buffer.byteLength > MAX_AUDIO_BYTES) {
    logWarn("[chatAttachments] audio too large for Whisper", {
      objectPath: att.objectPath,
      bytes: dl.buffer.byteLength,
    });
    return null;
  }
  try {
    const { toFile } = await import("openai");
    const file = await toFile(dl.buffer, att.fileName, { type: dl.contentType });
    const result = await openai.audio.transcriptions.create({
      file,
      model: WHISPER_MODEL,
    });
    const text = (result.text || "").trim();
    return text || null;
  } catch (err) {
    logError(
      "[chatAttachments] Whisper transcription failed",
      { objectPath: att.objectPath },
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}

async function extractTextFromDocOrImage(
  att: ChatAttachmentInput,
  cap: number,
): Promise<string | null> {
  try {
    const blocks = await extractDocumentContent(att.objectPath);
    const text = blocks
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (!text) return null;
    return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text;
  } catch (err) {
    logWarn("[chatAttachments] extractDocumentContent failed", {
      objectPath: att.objectPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Process every attachment in parallel; returns the persistable payload
 * (input + extracted/transcript fields) and a single text block ready to
 * splice into the user prompt envelope.
 *
 * Authorization: each attachment's `objectPath` is ACL-checked against
 * `userId` + `organizationId` BEFORE any download/extract/transcribe call.
 * Unauthorized paths are dropped with a warn-level log entry and never
 * reach Whisper, the document extractor, the persisted attachments JSONB,
 * or the prompt envelope.
 */
export async function processChatAttachments(
  attachments: ChatAttachmentInput[],
  ctx: { userId: string; organizationId: string },
): Promise<{ stored: ChatAttachmentStored[]; promptBlock: string | null; rejected: number }> {
  if (!attachments.length) return { stored: [], promptBlock: null, rejected: 0 };

  let rejected = 0;
  const processed = (
    await Promise.all(
      attachments.map(async (att): Promise<ChatAttachmentStored | null> => {
        const authorizedFile = await authorizeAndResolveObject(
          att.objectPath,
          ctx.userId,
          ctx.organizationId,
        );
        if (!authorizedFile) {
          rejected += 1;
          return null;
        }
        if (att.kind === "audio") {
          const transcript = await transcribeAudio(att, authorizedFile);
          return transcript ? { ...att, transcript } : { ...att };
        }
        const cap = att.kind === "image" ? MAX_IMAGE_OCR_CHARS : MAX_DOC_CHARS;
        const extractedText = await extractTextFromDocOrImage(att, cap);
        return extractedText ? { ...att, extractedText } : { ...att };
      }),
    )
  ).filter((p): p is ChatAttachmentStored => p !== null);

  // Build the prompt-side block. Each per-attachment payload is wrapped in
  // quarantineUserText so a hostile filename/body cannot escape the envelope.
  // Per-section content is capped before wrapping; we never truncate the
  // joined block mid-wrapper because that would shred guard boundaries.
  const sections: string[] = [];
  for (const att of processed) {
    const safeName = att.fileName.replace(/[\r\n]+/g, " ").slice(0, 120);
    if (att.kind === "audio") {
      if (att.transcript) {
        const cappedTranscript = att.transcript.length > MAX_DOC_CHARS
          ? `${att.transcript.slice(0, MAX_DOC_CHARS)}\n…[truncated]`
          : att.transcript;
        sections.push(
          quarantineUserText(
            `voice-note:${safeName}`,
            `[Voice note transcript — ${safeName}]\n${cappedTranscript}`,
          ),
        );
      } else {
        sections.push(
          quarantineUserText(
            `voice-note:${safeName}`,
            `[Voice note — ${safeName}] Transcription failed; the user attached an audio file but no transcript could be produced.`,
          ),
        );
      }
      continue;
    }
    const label = att.kind === "image" ? "Image" : "Document";
    if (att.extractedText) {
      sections.push(
        quarantineUserText(
          `${att.kind}:${safeName}`,
          `[${label} attachment — ${safeName} (${att.contentType})]\n${att.extractedText}`,
        ),
      );
    } else {
      sections.push(
        quarantineUserText(
          `${att.kind}:${safeName}`,
          `[${label} attachment — ${safeName} (${att.contentType})] No readable text could be extracted; consider asking the user to describe what's in the file.`,
        ),
      );
    }
  }

  // Per-section truncation: if the total joined block would exceed the cap,
  // drop whole sections from the tail rather than slicing mid-wrapper.
  let totalLen = 0;
  const fittedSections: string[] = [];
  for (const s of sections) {
    if (totalLen + s.length + 2 > MAX_PROMPT_BLOCK_CHARS) {
      fittedSections.push(`…[${sections.length - fittedSections.length} attachment(s) omitted to stay under prompt budget]`);
      break;
    }
    fittedSections.push(s);
    totalLen += s.length + 2;
  }

  const promptBlock: string | null = fittedSections.length
    ? `USER ATTACHMENTS (${processed.length}):\n\n${fittedSections.join("\n\n")}`
    : null;

  logInfo("[chatAttachments] processed", {
    count: processed.length,
    rejected,
    transcribed: processed.filter((p) => p.transcript).length,
    extracted: processed.filter((p) => p.extractedText).length,
  });

  return { stored: processed, promptBlock, rejected };
}
