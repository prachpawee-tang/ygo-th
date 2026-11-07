// Minimal GitHub REST + issue-form helpers (no dependencies)
export const REPO = process.env.GITHUB_REPOSITORY || "prachpawee-tang/ygo-th";

export async function gh(path, { method = "GET", body, token = process.env.GITHUB_TOKEN } = {}) {
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "ygo-th-bot",
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

/** Parse a GitHub issue-form body ("### Label\n\nvalue") into { label: value }. */
export function parseForm(body) {
  const out = {};
  for (const part of String(body || "").split(/^### /m).slice(1)) {
    const nl = part.indexOf("\n");
    const label = part.slice(0, nl).trim();
    // issue bodies arrive with \r\n — normalise so "same as current" checks and saved cards use \n
    let value = part.slice(nl + 1).replace(/\r\n?/g, "\n").trim();
    if (value === "_No response_") value = "";
    out[label] = value;
  }
  return out;
}

/** Fetch the English card text for a passcode from YGOPRODeck (one request; their API asks for ≤20/s). */
export async function fetchEnglish(passcode) {
  const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(passcode)}`, {
    headers: { "user-agent": "ygo-th (github.com/prachpawee-tang/ygo-th)" }
  });
  if (!res.ok) return null;
  const card = (await res.json())?.data?.[0];
  return card ? { id: String(card.id), name: card.name, en: card.desc } : null;
}

/** Quote untrusted text for a GitHub comment so it cannot render markdown, mentions or links. */
export const fence = s => "```text\n" + String(s).replace(/```/g, "ˋˋˋ").slice(0, 4000) + "\n```";
