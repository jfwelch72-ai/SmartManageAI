// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProposedActionCard } from "@/components/AiEstimatorChatPanel";
import { queryClient, bidEstimateKey } from "@/lib/queryClient";

const BID_ID = "bid-001";

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const BASE_LINE_ITEM = {
  id: "item-1",
  materialCost: "1000",
  laborCost: "500",
  equipmentCost: "200",
  subcontractCost: "300",
};

const CACHED_ESTIMATE = {
  estimate: {
    lineItems: [BASE_LINE_ITEM],
    totals: { totalCost: "5000" },
  },
};

function noop() {}

beforeEach(() => {
  queryClient.clear();
});

describe("ProposedActionCard — cost-delta preview", () => {
  it("add card shows correct total delta", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);

    const action = {
      toolCallId: "tc-add",
      action: "add" as const,
      payload: {
        description: "New concrete slab",
        materialCost: 800,
        laborCost: 400,
        equipmentCost: 0,
        subcontractCost: 0,
        category: "Concrete",
        quantity: 10,
        unit: "CY",
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    const preview = screen.getByTestId("cost-delta-preview-tc-add");
    expect(preview).toBeTruthy();
    // totalCost = 800 + 400 = 1,200; new estimate total = 5,000 + 1,200 = 6,200
    expect(preview.textContent).toContain(fmt(5000));
    expect(preview.textContent).toContain(fmt(6200));
    expect(preview.textContent).toContain(`+${fmt(1200)}`);
  });

  it("edit card handles partial payload (only some cost fields changed)", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);
    // existing item total = 1000 + 500 + 200 + 300 = 2,000

    const action = {
      toolCallId: "tc-edit-partial",
      action: "edit" as const,
      payload: {
        id: "item-1",
        // only laborCost is provided; other fields should fall back to existing values
        laborCost: 900,
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    const preview = screen.getByTestId("cost-delta-preview-tc-edit-partial");
    // proposed = 1000(mat kept) + 900(lab new) + 200(equip kept) + 300(sub kept) = 2,400
    // delta = 2,400 - 2,000 = +400
    // new total = 5,000 + 400 = 5,400
    expect(preview.textContent).toContain(fmt(5000));
    expect(preview.textContent).toContain(fmt(5400));
    expect(preview.textContent).toContain(`+${fmt(400)}`);
  });

  it("edit card handles full payload (all cost fields replaced)", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);
    // existing item total = 2,000

    const action = {
      toolCallId: "tc-edit-full",
      action: "edit" as const,
      payload: {
        id: "item-1",
        materialCost: 500,
        laborCost: 250,
        equipmentCost: 100,
        subcontractCost: 150,
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    const preview = screen.getByTestId("cost-delta-preview-tc-edit-full");
    // proposed = 500 + 250 + 100 + 150 = 1,000
    // delta = 1,000 - 2,000 = -1,000
    // new total = 5,000 - 1,000 = 4,000
    // The component renders negative delta as formatCurrency(-1000) = "$-1,000.00"
    expect(preview.textContent).toContain(fmt(5000));
    expect(preview.textContent).toContain(fmt(4000));
    expect(preview.textContent).toContain(fmt(-1000));
  });

  it("delete card shows removal cost for the existing item", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);
    // existing item total = 1000 + 500 + 200 + 300 = 2,000

    const action = {
      toolCallId: "tc-delete",
      action: "delete" as const,
      payload: {
        id: "item-1",
        description: "Concrete slab",
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    const preview = screen.getByTestId("cost-delta-preview-tc-delete");
    expect(preview.textContent).toContain("Removes");
    expect(preview.textContent).toContain(fmt(2000));
  });

  it("preview hidden when no cached estimate (bidId present but cache empty)", () => {
    // queryClient is cleared in beforeEach — no data set

    const action = {
      toolCallId: "tc-no-cache",
      action: "add" as const,
      payload: {
        description: "New item",
        materialCost: 500,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    expect(screen.queryByTestId("cost-delta-preview-tc-no-cache")).toBeNull();
  });

  it("preview hidden when bidId is absent", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);

    const action = {
      toolCallId: "tc-no-bid",
      action: "add" as const,
      payload: {
        description: "New item",
        materialCost: 500,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        // bidId intentionally omitted
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    expect(screen.queryByTestId("cost-delta-preview-tc-no-bid")).toBeNull();
  });

  it("preview hidden for edit when referenced item does not exist in cache", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);

    const action = {
      toolCallId: "tc-edit-missing",
      action: "edit" as const,
      payload: {
        id: "nonexistent-item",
        laborCost: 999,
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    expect(screen.queryByTestId("cost-delta-preview-tc-edit-missing")).toBeNull();
  });

  it("preview hidden for add when total cost is zero (zero-delta suppression)", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), CACHED_ESTIMATE);

    const action = {
      toolCallId: "tc-zero-delta",
      action: "add" as const,
      payload: {
        description: "Placeholder item",
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        category: "General",
        quantity: 1,
        unit: "LS",
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    // totalCost = 0 → showDeltaPreview is false for add
    expect(screen.queryByTestId("cost-delta-preview-tc-zero-delta")).toBeNull();
  });

  it("preview hidden for delete when referenced item does not exist in cache", () => {
    queryClient.setQueryData(bidEstimateKey(BID_ID), {
      estimate: {
        lineItems: [],
        totals: { totalCost: "5000" },
      },
    });
    // existingItemCost = 0 → showDeltaPreview is false for delete

    const action = {
      toolCallId: "tc-delete-missing",
      action: "delete" as const,
      payload: {
        id: "nonexistent-item",
        description: "Ghost item",
      },
    };

    render(
      <ProposedActionCard
        action={action}
        messageId="msg-1"
        sessionId="sess-1"
        bidId={BID_ID}
        state="idle"
        onApply={noop}
        onReject={noop}
        onUndo={noop}
      />,
    );

    expect(screen.queryByTestId("cost-delta-preview-tc-delete-missing")).toBeNull();
  });
});
