/**
 * Task #1610 — Unit tests for the revision-match helpers used by
 * `PlansTab.handleObjectUploadComplete` to auto-prompt the user to carry
 * pins / markups forward when a new PDF supersedes an older plan_documents
 * row. Mounting PlansTab itself for these branches is impractical (2k+ LOC,
 * many integrated subsystems), so the matching logic is exercised here.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeDocBaseName,
  findSupersededPdfDoc,
  uploadOutcomeToast,
  type PdfDocCandidate,
} from "../planRevisionMatch";

describe("normalizeDocBaseName", () => {
  it("strips file extensions", () => {
    expect(normalizeDocBaseName("Plan A.pdf")).toBe("plan a");
    expect(normalizeDocBaseName("PLAN_A.PDF")).toBe("plan a");
  });

  it("strips common revision suffixes (rev, v, r, revision)", () => {
    expect(normalizeDocBaseName("PlanA_Rev1.pdf")).toBe("plana");
    expect(normalizeDocBaseName("PlanA_Rev2.pdf")).toBe("plana");
    expect(normalizeDocBaseName("PlanA-v3.pdf")).toBe("plana");
    expect(normalizeDocBaseName("PlanA r4.pdf")).toBe("plana");
    expect(normalizeDocBaseName("PlanA_Revision_5.pdf")).toBe("plana");
    expect(normalizeDocBaseName("Plan A_Rev 6")).toBe("plan a");
  });

  it("strips windows-style copy suffixes", () => {
    expect(normalizeDocBaseName("PlanA (1).pdf")).toBe("plana");
    expect(normalizeDocBaseName("PlanA-2.pdf")).toBe("plana");
  });

  it("strips trailing date stamps", () => {
    expect(normalizeDocBaseName("Site_Plan_2024-01-15.pdf")).toBe("site plan");
  });

  it("returns identical normalized base names for differing rev suffixes", () => {
    expect(normalizeDocBaseName("Foundations_Rev1.pdf")).toBe(
      normalizeDocBaseName("Foundations_Rev2.pdf"),
    );
  });

  it("collapses separators consistently", () => {
    expect(normalizeDocBaseName("Plan-A___B")).toBe("plan a b");
    expect(normalizeDocBaseName("plan_a_b")).toBe("plan a b");
  });
});

describe("findSupersededPdfDoc", () => {
  const existing: PdfDocCandidate[] = [
    {
      id: "doc-old-1",
      title: "Foundations_Rev1",
      fileName: "Foundations_Rev1.pdf",
      uploadedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "doc-old-2",
      title: "Foundations_Rev2",
      fileName: "Foundations_Rev2.pdf",
      uploadedAt: "2026-02-01T00:00:00Z",
    },
    {
      id: "doc-other",
      title: "Site Plan",
      fileName: "Site_Plan.pdf",
      uploadedAt: "2026-01-15T00:00:00Z",
    },
  ];

  it("returns the most recently uploaded matching candidate", () => {
    const match = findSupersededPdfDoc(
      { title: "Foundations_Rev3", fileName: "Foundations_Rev3.pdf" },
      existing,
    );
    expect(match).not.toBeNull();
    expect(match!.id).toBe("doc-old-2");
  });

  it("returns null when there's no plausible candidate", () => {
    const match = findSupersededPdfDoc(
      { title: "Brand New Sheet", fileName: "Brand_New_Sheet.pdf" },
      existing,
    );
    expect(match).toBeNull();
  });

  it("returns null when the existing list is empty", () => {
    const match = findSupersededPdfDoc(
      { title: "Anything", fileName: "Anything.pdf" },
      [],
    );
    expect(match).toBeNull();
  });

  it("matches when only the file name overlaps (custom title differs)", () => {
    const match = findSupersededPdfDoc(
      { title: "Brand New Title", fileName: "Foundations_Rev9.pdf" },
      existing,
    );
    expect(match).not.toBeNull();
    expect(match!.id).toBe("doc-old-2");
  });

  it("matches when only the title overlaps (file name differs)", () => {
    const match = findSupersededPdfDoc(
      { title: "Foundations_Rev9", fileName: "totally-different.pdf" },
      existing,
    );
    expect(match).not.toBeNull();
    expect(match!.id).toBe("doc-old-2");
  });

  it("ignores empty title/fileName inputs", () => {
    expect(findSupersededPdfDoc({ title: "", fileName: "" }, existing)).toBeNull();
  });

  it("falls back to lexical order when uploadedAt is missing", () => {
    const noDates: PdfDocCandidate[] = [
      { id: "a", title: "Plan A", fileName: "Plan_A.pdf" },
      { id: "b", title: "Plan A", fileName: "Plan_A.pdf" },
    ];
    const match = findSupersededPdfDoc(
      { title: "Plan A_Rev2", fileName: "Plan_A_Rev2.pdf" },
      noDates,
    );
    expect(match).not.toBeNull();
    // Both have identical timestamps (0); the first one is acceptable.
    expect(["a", "b"]).toContain(match!.id);
  });
});

describe("uploadOutcomeToast", () => {
  it("returns null when nothing was attempted", () => {
    expect(uploadOutcomeToast(0, 0)).toBeNull();
  });

  it("reports a single successful save with the friendly success toast", () => {
    expect(uploadOutcomeToast(1, 0)).toEqual({ title: "Document uploaded" });
  });

  it("reports a multi-file all-success batch", () => {
    expect(uploadOutcomeToast(3, 0)).toEqual({
      title: "3 files uploaded",
      description: "All documents have been added.",
    });
  });

  it("reports a destructive error toast when the only file fails (regression for #1610 review)", () => {
    expect(uploadOutcomeToast(0, 1)).toEqual({
      title: "Error",
      description: "Failed to save document",
      variant: "destructive",
    });
  });

  it("reports a destructive error when every file in the batch fails", () => {
    expect(uploadOutcomeToast(0, 4)).toEqual({
      title: "Error",
      description: "Failed to save 4 documents",
      variant: "destructive",
    });
  });

  it("reports partial success/failure with explicit counts", () => {
    expect(uploadOutcomeToast(2, 1)).toEqual({
      title: "2 of 3 files uploaded",
      description: "1 failed to save.",
      variant: "destructive",
    });
  });
});
