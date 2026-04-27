// @vitest-environment jsdom
/**
 * Locks the wording of the shared export-failure toast: the friendlier
 * 403 message naming the export, plus the generic "Couldn't generate
 * <artifact>" fallback for other failures.
 */
import { describe, it, expect } from "vitest";

import {
  getExportResponseErrorToast,
  getExportThrownErrorToast,
} from "../exportErrors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body = ""): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("getExportResponseErrorToast", () => {
  it("renders the friendly permission toast naming the subject on 403", async () => {
    const toast = await getExportResponseErrorToast(
      jsonResponse(403, { error: "Forbidden" }),
      { artifact: "PDF", subject: "estimate" },
    );
    expect(toast).toEqual({
      title: "Export access required",
      description:
        "Your role no longer has estimate export access. Ask an admin to grant it, then try again.",
      variant: "destructive",
    });
  });

  it("uses the configured subject so SOV exports name the SOV", async () => {
    const toast = await getExportResponseErrorToast(
      jsonResponse(403, { error: "Forbidden" }),
      { artifact: "PDF", subject: "SOV" },
    );
    expect(toast.description).toContain("SOV export access");
  });

  it.each([
    ["change order", "change order export access"],
    ["project vault", "project vault export access"],
    ["punch list", "punch list export access"],
    ["portfolio", "portfolio export access"],
    ["AIA pay application", "AIA pay application export access"],
    ["schedule", "schedule export access"],
  ])(
    "names the %s in the friendly 403 toast",
    async (subject, expected) => {
      const toast = await getExportResponseErrorToast(
        jsonResponse(403, { error: "Forbidden" }),
        { artifact: "PDF", subject },
      );
      expect(toast.title).toBe("Export access required");
      expect(toast.description).toContain(expected);
    },
  );

  it("falls back to the server-provided detail for non-403 JSON errors", async () => {
    const toast = await getExportResponseErrorToast(
      jsonResponse(500, { error: "Renderer crashed" }),
      { artifact: "PDF", subject: "estimate" },
    );
    expect(toast).toEqual({
      title: "Couldn't generate PDF",
      description: "Renderer crashed. Please try again.",
      variant: "destructive",
    });
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const toast = await getExportResponseErrorToast(
      textResponse(500, "<html>boom</html>"),
      { artifact: "PDF", subject: "change order" },
    );
    expect(toast.description).toBe("Server responded with 500. Please try again.");
  });

  it("uses the artifact label so non-PDF exports keep matching wording", async () => {
    const toast = await getExportResponseErrorToast(
      textResponse(500),
      { artifact: "PDF ZIP", subject: "change order" },
    );
    expect(toast.title).toBe("Couldn't generate PDF ZIP");
  });

  it("does not double-punctuate when the server detail already ends in '.'", async () => {
    const toast = await getExportResponseErrorToast(
      jsonResponse(500, { error: "Renderer crashed." }),
      { artifact: "PDF", subject: "estimate" },
    );
    expect(toast.description).toBe("Renderer crashed. Please try again.");
  });
});

describe("getExportThrownErrorToast", () => {
  it("recognises errors with status 403 (the apiRequest-thrown shape)", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    const toast = getExportThrownErrorToast(err, { artifact: "PDF", subject: "SOV" });
    expect(toast.title).toBe("Export access required");
    expect(toast.description).toContain("SOV export access");
  });

  it("renders the generic 'Couldn't generate' toast with the error message", () => {
    const toast = getExportThrownErrorToast(new Error("network down"), {
      artifact: "PDF",
      subject: "estimate",
    });
    expect(toast).toEqual({
      title: "Couldn't generate PDF",
      description: "network down. Please try again.",
      variant: "destructive",
    });
  });

  it("falls back to a generic network message when the throw has no message", () => {
    const toast = getExportThrownErrorToast({}, { artifact: "PDF", subject: "estimate" });
    expect(toast.description).toBe("Network error. Please try again.");
  });

  it("ignores non-403 status fields and keeps the generic toast", () => {
    const err = Object.assign(new Error("boom"), { status: 500 });
    const toast = getExportThrownErrorToast(err, { artifact: "PDF", subject: "estimate" });
    expect(toast.title).toBe("Couldn't generate PDF");
    expect(toast.description).toBe("boom. Please try again.");
  });
});
