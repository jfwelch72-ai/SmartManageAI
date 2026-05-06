// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

// JSDOM stubs the virtualizer needs to compute a visible window:
// without them the scroll element reports 0×0 and nothing renders.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).ResizeObserver = RO;
  }
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      const h = this.style.height;
      if (h && h.endsWith("px")) return parseInt(h, 10);
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = this.style.height;
    const height = h && h.endsWith("px") ? parseInt(h, 10) : 600;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: height,
      width: 800,
      height,
      toJSON() {},
    } as DOMRect;
  };
});

function FakeContactsList({ count }: { count: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `c-${i}`,
    name: `Contact ${i}`,
  }));
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 8,
    initialRect: { width: 800, height: 600 },
    initialOffset: 0,
    observeElementRect: (_, cb) => {
      cb({ width: 800, height: 600 });
      return () => {};
    },
    observeElementOffset: (_, cb) => {
      cb(0, false);
      return () => {};
    },
  });
  return (
    <div
      ref={scrollRef}
      data-testid="scroll"
      style={{ height: "600px", overflow: "auto" }}
    >
      <div
        style={{
          height: `${v.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {v.getVirtualItems().map((vi) => (
          <div
            key={rows[vi.index].id}
            data-testid={`row-${rows[vi.index].id}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
              height: `${vi.size}px`,
            }}
          >
            {rows[vi.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("CRM contacts virtualization", () => {
  it("renders only a small DOM window for a 10,000-row dataset", () => {
    const { container, getByTestId } = render(<FakeContactsList count={10_000} />);
    const rendered = container.querySelectorAll('[data-testid^="row-c-"]');
    // The total dataset is 10k but the virtualizer only paints a small
    // visible window (overscan is 8 so we expect well under 100 nodes).
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
    // The scroll container's inner spacer must reserve full height so
    // the scrollbar is sized for the entire dataset.
    const inner = getByTestId("scroll").firstChild as HTMLElement;
    const reserved = parseInt(inner.style.height, 10);
    // 10k × 52px estimate = 520_000px; allow some slack.
    expect(reserved).toBeGreaterThan(400_000);
  });
});
