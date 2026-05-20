import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import type { SupportTicketReply } from "@shared/schema";

const MAX_SSE_RETRIES = 3;
const POLLING_INTERVAL_MS = 30_000;

interface UseTicketStreamOptions {
  onNewReply?: (reply: SupportTicketReply) => void;
}

/**
 * Opens a real-time SSE connection to /api/support/tickets/:id/stream and
 * appends incoming replies to the TanStack Query cache for the ticket's reply
 * queries. Falls back to 30-second polling if EventSource is unavailable or
 * the connection fails after 3 retries.
 */
export function useTicketStream(
  ticketId: string | undefined,
  adminPath: boolean = false,
  options: UseTicketStreamOptions = {},
) {
  const retryCountRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [usingPolling, setUsingPolling] = useState(false);
  const [newReplyArrived, setNewReplyArrived] = useState(false);

  const userRepliesKey = ticketId ? ["/api/support/my-tickets", ticketId, "replies"] : null;
  const adminRepliesKey = ticketId ? ["/api/support/tickets", ticketId, "replies"] : null;

  function invalidateReplies() {
    if (userRepliesKey) {
      queryClient.invalidateQueries({ queryKey: userRepliesKey });
    }
    if (adminPath && adminRepliesKey) {
      queryClient.invalidateQueries({ queryKey: adminRepliesKey });
    }
  }

  function appendReply(reply: SupportTicketReply) {
    if (userRepliesKey && !adminPath) {
      queryClient.setQueryData<{ replies: SupportTicketReply[] }>(
        userRepliesKey,
        (old) => {
          if (!old) return { replies: [reply] };
          if (old.replies.some((r) => r.id === reply.id)) return old;
          return { replies: [...old.replies, reply] };
        },
      );
    }
    if (adminPath && adminRepliesKey) {
      queryClient.setQueryData<{ replies: SupportTicketReply[] }>(
        adminRepliesKey,
        (old) => {
          if (!old) return { replies: [reply] };
          if (old.replies.some((r) => r.id === reply.id)) return old;
          return { replies: [...old.replies, reply] };
        },
      );
    }
    setNewReplyArrived(true);
    options.onNewReply?.(reply);
  }

  function startPolling() {
    if (pollingRef.current) return;
    setUsingPolling(true);
    pollingRef.current = setInterval(() => {
      invalidateReplies();
    }, POLLING_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function closeEs() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }

  useEffect(() => {
    if (!ticketId) return;

    if (typeof EventSource === "undefined") {
      startPolling();
      return () => stopPolling();
    }

    function connect() {
      closeEs();
      const es = new EventSource(`/api/support/tickets/${ticketId}/stream`, {
        withCredentials: true,
      });
      esRef.current = es;

      es.addEventListener("reply", (e: MessageEvent) => {
        try {
          const reply = JSON.parse(e.data) as SupportTicketReply;
          appendReply(reply);
        } catch {
          // malformed event — ignore
        }
      });

      es.addEventListener("connected", () => {
        retryCountRef.current = 0;
        setUsingPolling(false);
        stopPolling();
      });

      es.onerror = () => {
        es.close();
        retryCountRef.current += 1;
        if (retryCountRef.current >= MAX_SSE_RETRIES) {
          startPolling();
        } else {
          const delay = Math.min(1_000 * 2 ** retryCountRef.current, 30_000);
          setTimeout(() => {
            if (retryCountRef.current < MAX_SSE_RETRIES) connect();
          }, delay);
        }
      };
    }

    connect();

    return () => {
      closeEs();
      stopPolling();
    };
  }, [ticketId]);

  function clearNewReplyFlag() {
    setNewReplyArrived(false);
  }

  return { usingPolling, newReplyArrived, clearNewReplyFlag };
}
