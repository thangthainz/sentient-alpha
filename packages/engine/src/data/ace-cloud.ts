import { DATA_SOURCES } from "@sentient-alpha/shared";

const BASE = DATA_SOURCES.ACE_DATA_CLOUD;

export async function aceSentimentAnalysis(
  topic: string,
  apiKey: string
): Promise<{ sentiment: number; summary: string }> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a crypto market sentiment analyzer. Given a topic, return a JSON object with: " +
            '"sentiment" (float 0-1, where 0=very bearish, 0.5=neutral, 1=very bullish) and ' +
            '"summary" (1-2 sentence analysis). Return ONLY valid JSON.',
        },
        { role: "user", content: `Analyze current market sentiment for: ${topic}` },
      ],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    console.error(`[ACE] Sentiment error: ${res.status}`);
    return { sentiment: 0.5, summary: "unavailable" };
  }

  const data = await res.json() as any;
  const content = data?.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(content);
    return {
      sentiment: Math.max(0, Math.min(1, parsed.sentiment ?? 0.5)),
      summary: parsed.summary ?? content,
    };
  } catch {
    return { sentiment: 0.5, summary: content.slice(0, 200) };
  }
}

export async function aceSearchMarket(
  query: string,
  apiKey: string
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await fetch(`${BASE}/serp/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, number: 5, gl: "us", hl: "en" }),
  });

  if (!res.ok) {
    console.error(`[ACE] Search error: ${res.status}`);
    return [];
  }

  const raw = await res.json() as any;
  return (raw.organic || raw.results || []).map((r: any) => ({
    title: r.title ?? "",
    url: r.link ?? r.url ?? "",
    snippet: r.snippet ?? r.description ?? "",
  }));
}

export async function aceGenerateImage(
  prompt: string,
  apiKey: string
): Promise<string> {
  const endpoints = [
    { url: `${BASE}/midjourney/imagine`, body: { prompt, process_mode: "fast" } },
    { url: `${BASE}/v1/images/generations`, body: { model: "flux", prompt, n: 1, size: "1024x1024" } },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(ep.body),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const url = data.image_url || data.images?.[0]?.url || data.data?.[0]?.url || "";
        if (url) return url;
      }
    } catch { continue; }
  }

  return "";
}
