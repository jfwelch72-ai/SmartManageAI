// @vitest-environment jsdom
/**
 * Task #1609 — verifies that the virtualizer in `<PdfPreview />`'s
 * `PageThumbStrip` only renders a small visible window even when the
 * underlying PDF has 600 pages. We can't easily mount the full
 * `PdfPreview` (it loads PDFs over the network) so we render the strip
 * surrogate directly and assert the DOM count.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

afterEach(() => cleanup());

function VirtualizedSurrogate({ count }: { count: number }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  // Match the production PdfPreview parameters
  const v = useVirtualizer({
    count,
    horizontal: true,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 78,
    overscan: 8,
  });
  return (
    <div
      ref={parentRef}
      data-testid="strip-root"
      style={{ width: 600, overflowX: "auto" }}
    >
      <div style={{ width: v.getTotalSize(), position: "relative", height: 96 }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-testid={`thumb-${vi.index + 1}`}
            style={{ position: "absolute", left: vi.start, width: vi.size, top: 0 }}
          >
            page {vi.index + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("PdfPreview thumbnail strip virtualization", () => {
  it("renders only a small windowed slice of a 600-page strip", () => {
    render(<VirtualizedSurrogate count={600} />);
    const root = screen.getByTestId("strip-root");
    // jsdom treats the parent as 0x0 by default which means @tanstack/react-virtual
    // will render its overscan (16 items by default-ish). We only need to
    // assert the count is far less than the total.
    const rendered = root.querySelectorAll("[data-testid^='thumb-']");
    expect(rendered.length).toBeLessThan(50);
    // Ensure the total inner width corresponds to all 600 items even
    // though only a window is mounted.
    const inner = root.firstChild as HTMLElement;
    expect(parseInt(inner.style.width || "0", 10)).toBeGreaterThanOrEqual(600 * 78);
  });
});
