import { logError, logInfo } from "../utils/logger";

const SLACK_HOST_PATTERN = /^https:\/\/hooks\.slack\.com\//;

export function isValidSlackWebhookUrl(url: string): boolean {
  return SLACK_HOST_PATTERN.test(url);
}

export async function sendSlackMessage(
  webhookUrl: string,
  title: string,
  message: string,
  actionUrl?: string
): Promise<void> {
  if (!webhookUrl || !isValidSlackWebhookUrl(webhookUrl)) {
    logError("slackService: invalid or missing webhook URL");
    return;
  }

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: title, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: message },
    },
  ];

  if (actionUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in App" },
          url: actionUrl,
          action_id: "open_app",
        },
      ],
    });
  }

  const payload = { blocks };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logError("slackService: webhook POST failed", { status: res.status, body: errBody });
    } else {
      logInfo("slackService: message sent");
    }
  } catch (err) {
    logError("slackService: fetch failed", { error: String(err) });
  }
}
