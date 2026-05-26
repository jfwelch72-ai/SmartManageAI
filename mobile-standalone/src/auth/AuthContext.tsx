import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, baseUrl, setAuthToken } from "@/api/client";

type User = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  organizationId: string | null;
};

type AuthCtx = {
  user: User | null;
  ready: boolean;
  /**
   * Email/password login. Throws an error whose message starts with
   * "SSO_REQUIRED:" when the org enforces SSO — callers should handle that
   * by invoking ssoLogin() with the org slug returned by the server.
   */
  login: (email: string, password: string) => Promise<void>;
  ssoLogin: (orgSlug: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User }>("/api/auth/me");
      setUser(me.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    // React Native's fetch() cannot reliably read Set-Cookie headers, so we
    // opt into a JSON-token response by sending the X-Mobile-Client header.
    // Server-side: see server/authProfileRoutes.ts — when this header is
    // present the login response includes { user, token }.
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Mobile-Client": "1",
      },
      body: JSON.stringify({ email, password }),
    });
    let body: unknown = null;
    try { body = await res.clone().json(); } catch { /* non-JSON */ }
    // Org enforces SSO — surface a typed error so the caller can pivot to the
    // SSO browser handoff.
    if (res.status === 403 && body && typeof body === "object" && (body as { ssoEnforced?: boolean }).ssoEnforced) {
      const slug = (body as { ssoSlug?: string }).ssoSlug ?? "";
      throw new Error(`SSO_REQUIRED:${slug}`);
    }
    if (!res.ok) {
      throw new Error((body as { error?: string } | null)?.error || (await res.text()) || "Login failed");
    }
    const token = (body as { token?: string } | null)?.token;
    if (!token) {
      throw new Error("Login response missing token (server may not be advertising X-Mobile-Client support)");
    }
    await setAuthToken(token);
    await refresh();
  }, [refresh]);

  // Mobile SSO handoff. Opens the existing web /login page in a system
  // browser tab targeting the org's SSO provider, then waits for the
  // /api/auth/mobile-exchange endpoint to redirect back to the
  // smartmanageai:// deep link with a freshly-minted JWT in the query string.
  const ssoLogin = useCallback(async (orgSlug: string) => {
    const redirectUrl = Linking.createURL("auth/callback");
    // Send the user straight to the SSO IdP login. After IdP success the web
    // session cookie is set, the SSO callback route redirects to /, the user
    // hits the protected exchange endpoint (already authed via cookie), and
    // gets bounced into the app via deep link.
    const ssoStartUrl = `${baseUrl}/api/sso/${encodeURIComponent(orgSlug)}/login?redirect=${encodeURIComponent(`/api/auth/mobile-exchange?redirect=${encodeURIComponent(redirectUrl)}`)}`;
    const consumeCallback = async (callbackUrl: string): Promise<void> => {
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      if (!code) throw new Error("SSO completed without an exchange code");
      // Atomically swap the one-time code for a JWT. The server invalidates
      // the code on first use so a leaked deep-link URL cannot be replayed.
      const { token } = await api<{ token: string }>("/api/auth/mobile-exchange/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      await setAuthToken(token);
      await refresh();
    };
    const result = await WebBrowser.openAuthSessionAsync(ssoStartUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      await consumeCallback(result.url);
      return;
    }
    // Some IdPs strip the redirect param — fall back to opening the web
    // /login page so the user can sign in and the cookie-bound exchange
    // call from inside the browser still completes the deep link.
    const fallback = `${baseUrl}/login?redirect=${encodeURIComponent(`/api/auth/mobile-exchange?redirect=${encodeURIComponent(redirectUrl)}`)}`;
    const fb = await WebBrowser.openAuthSessionAsync(fallback, redirectUrl);
    if (fb.type !== "success" || !fb.url) throw new Error("SSO sign-in cancelled");
    await consumeCallback(fb.url);
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    await setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, ssoLogin, logout }), [user, ready, login, ssoLogin, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
