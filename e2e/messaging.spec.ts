import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevLoginResponse {
  user: { id: string; role: string; email: string };
}

interface MessagingUser {
  id: string;
  role?: string;
  email?: string;
  firstName?: string;
}

interface Conversation {
  id: string;
  name?: string;
}

interface Message {
  id: string;
  content: string;
  conversationId: string;
}

interface MessagesResponse {
  messages?: Message[];
  data?: Message[];
}

async function devLogin(page: Page, role: string): Promise<DevLoginResponse> {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<DevLoginResponse>;
}

test.describe("Messaging E2E", () => {
  test("create conversation, send message, and verify it appears", async ({ page }) => {
    const adminLogin = await devLogin(page, "ADMIN");
    const adminId = adminLogin.user.id;

    const usersRes = await page.request.get(`${BASE_URL}/api/messaging/users`);
    expect(usersRes.status()).toBe(200);
    const usersList = (await usersRes.json()) as MessagingUser[];
    const otherUser = (Array.isArray(usersList) ? usersList : []).find(
      (u: MessagingUser) => u.id !== adminId
    );

    const participantIds = [adminId];
    if (otherUser) {
      participantIds.push(otherUser.id);
    }

    const convRes = await page.request.post(`${BASE_URL}/api/conversations`, {
      data: {
        participantIds,
        name: `PW Test Conv ${Date.now()}`,
      },
    });
    expect(convRes.status()).toBe(201);
    const conversation = (await convRes.json()) as Conversation;
    expect(conversation.id).toBeTruthy();
    const convId = conversation.id;

    const msgContent = `Hello from Playwright ${Date.now()}`;
    const msgRes = await page.request.post(`${BASE_URL}/api/conversations/${convId}/messages`, {
      data: { content: msgContent },
    });
    expect(msgRes.status()).toBe(201);
    const message = (await msgRes.json()) as Message;
    expect(message.id).toBeTruthy();
    expect(message.content).toBe(msgContent);

    const messagesRes = await page.request.get(`${BASE_URL}/api/conversations/${convId}/messages`);
    expect(messagesRes.status()).toBe(200);
    const messages = await messagesRes.json();
    const rawMessages = messages as Message[] | MessagesResponse;
    const msgList: Message[] = Array.isArray(rawMessages)
      ? rawMessages
      : (rawMessages as MessagesResponse).messages || (rawMessages as MessagesResponse).data || [];
    const found = msgList.find((m: Message) => m.content === msgContent);
    expect(found).toBeTruthy();
  });

  test("list conversations returns array", async ({ page }) => {
    await devLogin(page, "ADMIN");

    const convRes = await page.request.get(`${BASE_URL}/api/conversations`);
    expect(convRes.status()).toBe(200);
    const conversations = await convRes.json();
    expect(Array.isArray(conversations)).toBe(true);
  });

  test("send and edit a message", async ({ page }) => {
    const adminLogin = await devLogin(page, "ADMIN");
    const adminId = adminLogin.user.id;

    const convRes = await page.request.post(`${BASE_URL}/api/conversations`, {
      data: {
        participantIds: [adminId],
        name: `PW Edit Conv ${Date.now()}`,
      },
    });
    expect(convRes.status()).toBe(201);
    const conv = (await convRes.json()) as Conversation;

    const msgRes = await page.request.post(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
      data: { content: "Original message" },
    });
    expect(msgRes.status()).toBe(201);
    const msg = (await msgRes.json()) as Message;

    const editRes = await page.request.patch(`${BASE_URL}/api/messages/${msg.id}`, {
      data: { content: "Edited message" },
    });
    expect(editRes.status()).toBe(200);
    const edited = (await editRes.json()) as Message;
    expect(edited.content).toBe("Edited message");
  });

  test("send and delete a message", async ({ page }) => {
    const adminLogin = await devLogin(page, "ADMIN");
    const adminId = adminLogin.user.id;

    const convRes = await page.request.post(`${BASE_URL}/api/conversations`, {
      data: {
        participantIds: [adminId],
        name: `PW Del Conv ${Date.now()}`,
      },
    });
    expect(convRes.status()).toBe(201);
    const conv = (await convRes.json()) as Conversation;

    const msgRes = await page.request.post(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
      data: { content: "To be deleted" },
    });
    expect(msgRes.status()).toBe(201);
    const msg = (await msgRes.json()) as Message;

    const delRes = await page.request.delete(`${BASE_URL}/api/messages/${msg.id}`);
    expect(delRes.status()).toBe(200);
  });

  test("unread count endpoint returns count", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const res = await page.request.get(`${BASE_URL}/api/messages/unread-count`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(typeof body.count).toBe("number");
  });

  test("mark conversation as read", async ({ page }) => {
    const adminLogin = await devLogin(page, "ADMIN");
    const adminId = adminLogin.user.id;

    const convRes = await page.request.post(`${BASE_URL}/api/conversations`, {
      data: {
        participantIds: [adminId],
        name: `PW Read Conv ${Date.now()}`,
      },
    });
    expect(convRes.status()).toBe(201);
    const conv = (await convRes.json()) as Conversation;

    await page.request.post(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
      data: { content: "Read me" },
    });

    const readRes = await page.request.post(`${BASE_URL}/api/conversations/${conv.id}/read`);
    expect(readRes.status()).toBe(200);
  });

  test("message to nonexistent conversation returns error", async ({ page }) => {
    await devLogin(page, "ADMIN");
    const res = await page.request.post(
      `${BASE_URL}/api/conversations/00000000-0000-0000-0000-000000000000/messages`,
      { data: { content: "Should fail" } }
    );
    expect([400, 403, 404]).toContain(res.status());
  });

  test("message sent by one user is visible to the recipient", async ({ page, context }) => {
    const adminLogin = await devLogin(page, "ADMIN");
    const adminId = adminLogin.user.id;

    const usersRes = await page.request.get(`${BASE_URL}/api/messaging/users`);
    expect(usersRes.status()).toBe(200);
    const usersList = (await usersRes.json()) as MessagingUser[];
    const otherUser = (Array.isArray(usersList) ? usersList : []).find(
      (u: MessagingUser) => u.id !== adminId
    );

    expect(otherUser).toBeTruthy();

    const convRes = await page.request.post(`${BASE_URL}/api/conversations`, {
      data: {
        participantIds: [adminId, otherUser.id],
        name: `PW Recipient Conv ${Date.now()}`,
        type: "DIRECT",
      },
    });
    expect(convRes.status()).toBe(201);
    const conv = (await convRes.json()) as Conversation;

    const msgContent = `Recipient check ${Date.now()}`;
    const sendRes = await page.request.post(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
      data: { content: msgContent },
    });
    expect(sendRes.status()).toBe(201);

    const recipientPage = await context.newPage();
    const recipientRole = otherUser.role || "ESTIMATOR";
    const recipientLoginRes = await recipientPage.request.post(`${BASE_URL}/api/dev/test-login`, {
      data: { role: recipientRole },
    });
    expect(recipientLoginRes.status()).toBe(200);

    const recipientMsgsRes = await recipientPage.request.get(
      `${BASE_URL}/api/conversations/${conv.id}/messages`
    );
    expect(recipientMsgsRes.status()).toBe(200);
    const recipientMsgs = await recipientMsgsRes.json();
    const rawRecipientMsgs = recipientMsgs as Message[] | MessagesResponse;
    const msgList: Message[] = Array.isArray(rawRecipientMsgs)
      ? rawRecipientMsgs
      : (rawRecipientMsgs as MessagesResponse).messages || (rawRecipientMsgs as MessagesResponse).data || [];
    const found = msgList.find((m: Message) => m.content === msgContent);
    expect(found).toBeTruthy();

    await recipientPage.close();
  });
});
