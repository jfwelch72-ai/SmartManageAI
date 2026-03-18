import { logError, logInfo } from "../utils/logger";

// Teams incoming webhooks may come from either hooks.teams.microsoft.com (newer)
// or *.webhook.office.com (older / Power Automate connectors)
const TEAMS_HOST_PATTERNS = [
  /^https:\/\/[a-zA-Z0-9._-]+\.webhook\.office\.com\//,
  /^https:\/\/[a-zA-Z0-9._-]+\.hooks\.teams\.microsoft\.com\//,
  /^https:\/\/hooks\.teams\.microsoft\.com\//,
];

export function isValidTeamsWebhookUrl(url: string): boolean {
  return TEAMS_HOST_PATTERNS.some((pattern) => pattern.test(url));
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
