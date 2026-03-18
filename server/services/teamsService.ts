import { logError, logInfo } from "../utils/logger";

const TEAMS_HOST_PATTERN = /^https:\/\/[a-zA-Z0-9._-]+\.webhook\.office\.com\//;

export function isValidTeamsWebhookUrl(url: string): boolean {
  return TEAMS_HOST_PATTERN.test(url);
}

export async function sendTeamsMessage(
  webhookUrl: string,
  title: string,
  message: string,
  actionUrl?: string
): Promise<void> {
  if (!webhookUrl || !isValidTeamsWebhookUrl(webhookUrl)) {
    logError("teamsService: invalid or missing webhook URL");
    return;
  }

  const card: Record<string, unknown> = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: title,
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: message,
              wrap: true,
              spacing: "Small",
            },
          ],
          actions: actionUrl
            ? [
                {
                  type: "Action.OpenUrl",
                  title: "View in App",
                  url: actionUrl,
                },
              ]
            : [],
        },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logError("teamsService: webhook POST failed", { status: res.status, body: errBody });
    } else {
      logInfo("teamsService: message sent");
    }
  } catch (err) {
    logError("teamsService: fetch failed", { error: String(err) });
  }
}
