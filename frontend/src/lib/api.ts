const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export interface QuickStats {
  cpu: { percent: number; cores: number; per_core: number[] };
  memory: { percent: number; used_gb: number; total_gb: number };
  disk: { percent: number; used_gb: number; total_gb: number };
  network: { bytes_sent_mb: number; bytes_recv_mb: number };
  system: { hostname: string; os: string; uptime: string };
}

export interface Tool {
  name: string;
  description: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export async function fetchQuickStats(): Promise<QuickStats> {
  const r = await fetch(`${BASE}/quick-stats`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

export async function fetchTools(): Promise<Tool[]> {
  const r = await fetch(`${BASE}/tools`);
  if (!r.ok) throw new Error("Failed to fetch tools");
  return r.json();
}

export async function fetchHistory(sessionId: string) {
  const r = await fetch(`${BASE}/history/${sessionId}`);
  if (!r.ok) return { messages: [] };
  return r.json();
}

// Pricing per 1M tokens (gpt-4o-mini as default)
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o":      { input: 5.00, output: 15.00 },
  "gpt-4-turbo": { input: 10.00, output: 30.00 },
};

export function calcCost(usage: TokenUsage, model: string): number {
  const p = PRICING[model] ?? PRICING["gpt-4o-mini"];
  return (
    (usage.input_tokens / 1_000_000) * p.input +
    (usage.output_tokens / 1_000_000) * p.output
  );
}

export function createWS(): WebSocket {
  const wsBase = BASE.replace(/^http/, "ws");
  return new WebSocket(`${wsBase}/ws/chat`);
}
