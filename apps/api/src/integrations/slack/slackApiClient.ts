const SLACK_DEBUG = process.env.ORCHEST_SLACK_DEBUG === "1";

function redactSlackPayload(payload: Record<string, any>): Record<string, any> {
  // Avoid logging large/private content. Keep only high-signal routing fields.
  const allow = [
    "channel",
    "channel_id",
    "thread_ts",
    "ts",
    "user",
    "team_id",
    "canvas_id",
    "title",
    "changes",
    "document_content",
    "file",
  ];

  const out: Record<string, any> = {};
  for (const k of allow) {
    if (!(k in payload)) continue;
    const v = payload[k];
    if (k === "changes" && Array.isArray(v)) {
      out[k] = { count: v.length, operations: v.map((c: any) => c?.operation).filter(Boolean).slice(0, 10) };
      continue;
    }
    if (k === "document_content" && v && typeof v === "object") {
      const md = typeof v.markdown === "string" ? v.markdown : "";
      out[k] = { type: v.type, markdown_length: md.length };
      continue;
    }
    if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 200) + "…";
    else out[k] = v;
  }
  return out;
}

export async function slackApi(token: string, method: string, payload: Record<string, any>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const reqId = res.headers.get("x-slack-req-id") ?? undefined;
  const bodyText = await res.text();
  let json: any;
  try {
    json = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: non-JSON response: ${
        bodyText ? bodyText.slice(0, 800) : "(empty)"
      }`
    );
  }
  if (!json?.ok) {
    const err = String(json?.error ?? "unknown_error");
    const needed = json?.needed ? ` needed=${String(json.needed)}` : "";
    const provided = json?.provided ? ` provided=${String(json.provided)}` : "";
    const detail = SLACK_DEBUG && json?.detail ? ` detail=${String(json.detail).slice(0, 500)}` : "";
    const meta =
      SLACK_DEBUG && json?.response_metadata ? ` response_metadata=${JSON.stringify(json.response_metadata)}` : "";
    const payloadSummary = SLACK_DEBUG ? ` payload=${JSON.stringify(redactSlackPayload(payload))}` : "";
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: ${err}${detail}${needed}${provided}${payloadSummary}${meta}`
    );
  }
  return json;
}

export async function slackApiGet(token: string, method: string, params: Record<string, any>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.set(k, String(v));
    }
  }

  const url = `https://slack.com/api/${method}?${usp.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const reqId = res.headers.get("x-slack-req-id") ?? undefined;
  const bodyText = await res.text();
  let json: any;
  try {
    json = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: non-JSON response: ${
        bodyText ? bodyText.slice(0, 800) : "(empty)"
      }`
    );
  }
  if (!json?.ok) {
    const err = String(json?.error ?? "unknown_error");
    const needed = json?.needed ? ` needed=${String(json.needed)}` : "";
    const provided = json?.provided ? ` provided=${String(json.provided)}` : "";
    const detail = SLACK_DEBUG && json?.detail ? ` detail=${String(json.detail).slice(0, 500)}` : "";
    const meta =
      SLACK_DEBUG && json?.response_metadata ? ` response_metadata=${JSON.stringify(json.response_metadata)}` : "";
    const paramsSummary = SLACK_DEBUG ? ` params=${JSON.stringify(redactSlackPayload(params))}` : "";
    throw new Error(
      `Slack API ${method} failed (${res.status})${reqId ? ` [req ${reqId}]` : ""}: ${err}${detail}${needed}${provided}${paramsSummary}${meta}`
    );
  }
  return json;
}

