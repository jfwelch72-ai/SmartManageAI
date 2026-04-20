const PALETTE: { bg: string; text: string }[] = [
  { bg: "bg-rose-500", text: "text-white" },
  { bg: "bg-pink-500", text: "text-white" },
  { bg: "bg-fuchsia-500", text: "text-white" },
  { bg: "bg-purple-500", text: "text-white" },
  { bg: "bg-violet-500", text: "text-white" },
  { bg: "bg-indigo-500", text: "text-white" },
  { bg: "bg-blue-500", text: "text-white" },
  { bg: "bg-sky-600", text: "text-white" },
  { bg: "bg-cyan-600", text: "text-white" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-emerald-600", text: "text-white" },
  { bg: "bg-amber-600", text: "text-white" },
];

const NEUTRAL = { bg: "bg-muted", text: "text-muted-foreground" };

const TITLE_TOKEN = /^(mr|mrs|ms|miss|mx|dr|prof|sir|madam|rev|fr|sr|jr|ii|iii|iv|v|esq|md|phd|cpa|pe|raii?|do)\.?$/i;

function stripTitle(token: string): string {
  return token.replace(/[.,]+$/g, "");
}

function nameTokens(input: string): string[] {
  return input
    .split(/\s+/)
    .map(stripTitle)
    .filter((t) => t.length > 0 && !TITLE_TOKEN.test(t));
}

function firstChar(s: string): string {
  for (const ch of s) {
    if (/\p{L}|\p{N}/u.test(ch)) return ch.toUpperCase();
  }
  return "";
}

export function initialsFor(name?: string | null, email?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const tokens = nameTokens(trimmed);
    if (tokens.length >= 2) {
      const a = firstChar(tokens[0]);
      const b = firstChar(tokens[tokens.length - 1]);
      const result = `${a}${b}`;
      if (result.length > 0) return result;
    }
    if (tokens.length === 1) {
      const c = firstChar(tokens[0]);
      if (c) return c;
    }
    const c = firstChar(trimmed);
    if (c) return c;
  }

  const e = (email ?? "").trim();
  if (e) {
    const local = e.split("@")[0] ?? "";
    const parts = local.split(/[._\-+]+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstChar(parts[0]);
      const b = firstChar(parts[1]);
      const result = `${a}${b}`;
      if (result.length > 0) return result;
    }
    if (parts.length === 1) {
      const c = firstChar(parts[0]);
      if (c) return c;
    }
    const c = firstChar(e);
    if (c) return c;
  }

  return "?";
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForName(
  name?: string | null,
  email?: string | null,
): { bg: string; text: string } {
  const key = ((name ?? "").trim() || (email ?? "").trim()).toLowerCase();
  if (!key) return NEUTRAL;
  return PALETTE[hashString(key) % PALETTE.length];
}
