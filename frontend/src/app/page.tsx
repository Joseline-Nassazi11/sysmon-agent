"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchQuickStats, fetchTools, createWS,
  QuickStats, Tool, TokenUsage,
} from "@/lib/api";
import MetricCard from "@/components/MetricCard";
import HistoryChart from "@/components/HistoryChart";
import TokenDisplay from "@/components/TokenDisplay";
import ToolPanel from "@/components/ToolPanel";

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface HistoryPoint {
  time: string;
  cpu: number;
  memory: number;
}

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"];
const EMPTY_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

// ── Component ──────────────────────────────────────────────────────────────

export default function Home() {
  // System stats
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [statsError, setStatsError] = useState(false);

  // Agent chat
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "👋 Hello! I'm SysMonitor. Ask me anything about your system — CPU, memory, processes, logs, or network." },
  ]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Settings
  const [model, setModel] = useState("gpt-4o-mini");
  const [temperature, setTemperature] = useState(0);
  const [tools, setTools] = useState<Tool[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  // Token usage
  const [lastUsage, setLastUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [sessionUsage, setSessionUsage] = useState<TokenUsage>(EMPTY_USAGE);

  // ── Stats polling ────────────────────────────────────────────────────────

  const pollStats = useCallback(async () => {
    try {
      const s = await fetchQuickStats();
      setStats(s);
      setStatsError(false);
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setHistory((h) => {
        const next = [...h, { time: now, cpu: s.cpu.percent, memory: s.memory.percent }];
        return next.slice(-60);
      });
    } catch {
      setStatsError(true);
    }
  }, []);

  useEffect(() => {
    pollStats();
    const id = setInterval(pollStats, 3000);
    return () => clearInterval(id);
  }, [pollStats]);

  // ── Load tools ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetchTools().then((t) => {
      setTools(t);
      setEnabledTools(new Set(t.map((x) => x.name)));
    }).catch(() => {});
  }, []);

  // ── Auto-scroll chat ────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message via WebSocket ──────────────────────────────────────────

  const sendMessage = useCallback(() => {
    if (!input.trim() || isThinking) return;
    const text = input.trim();
    setInput("");
    setIsThinking(true);

    setMessages((m) => [...m, { role: "user", content: text }]);

    // Open WS
    const ws = createWS();
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        message: text,
        session_id: sessionId,
        model,
        temperature,
        enabled_tools: [...enabledTools],
      }));
      // Add streaming placeholder
      setMessages((m) => [...m, { role: "assistant", content: "", isStreaming: true }]);
    };

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);

      if (data.type === "token") {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.isStreaming) {
            copy[copy.length - 1] = { ...last, content: last.content + data.content };
          }
          return copy;
        });
      } else if (data.type === "tool_call") {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.isStreaming) {
            copy[copy.length - 1] = { ...last, content: last.content + "\n\n_" + data.content + "_\n\n" };
          }
          return copy;
        });
      } else if (data.type === "done") {
        const usage: TokenUsage = data.token_usage || EMPTY_USAGE;
        setLastUsage(usage);
        setSessionUsage((prev) => ({
          input_tokens: prev.input_tokens + usage.input_tokens,
          output_tokens: prev.output_tokens + usage.output_tokens,
          total_tokens: prev.total_tokens + usage.total_tokens,
        }));
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.isStreaming) {
            copy[copy.length - 1] = { ...last, isStreaming: false };
          }
          return copy;
        });
        setIsThinking(false);
        ws.close();
      } else if (data.type === "error") {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.isStreaming) {
            copy[copy.length - 1] = { ...last, content: "❌ Error: " + data.content, isStreaming: false };
          }
          return copy;
        });
        setIsThinking(false);
        ws.close();
      }
    };

    ws.onerror = () => {
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.isStreaming) {
          copy[copy.length - 1] = { ...last, content: "❌ Connection error. Is the backend running?", isStreaming: false };
        }
        return copy;
      });
      setIsThinking(false);
    };
  }, [input, isThinking, model, temperature, enabledTools, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Quick prompts ───────────────────────────────────────────────────────

  const quickPrompts = [
    "How is my system doing?",
    "What are the top CPU processes?",
    "Check my disk space",
    "Any errors in system logs?",
    "Where is this server located?",
  ];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-sm">
            ⚡
          </div>
          <span className="font-semibold text-gray-100">SysMonitor AI</span>
          {stats && (
            <span className="badge bg-green-950 text-green-400 text-xs">
              ● {stats.system.hostname}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <span className="text-xs text-gray-500 hidden sm:block">
              {stats.system.os} · up {stats.system.uptime}
            </span>
          )}
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800"
          >
            ⚙ Settings
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: metrics */}
        <aside className="w-72 border-r border-gray-800 overflow-y-auto p-3 flex flex-col gap-3 shrink-0">
          {statsError && (
            <div className="card border-red-900 text-red-400 text-xs">
              ⚠ Backend offline — start FastAPI server
            </div>
          )}

          {stats ? (
            <>
              <MetricCard
                label="CPU"
                percent={stats.cpu.percent}
                detail={`${stats.cpu.cores} cores`}
                icon={<span>⚙️</span>}
              />
              <MetricCard
                label="Memory"
                percent={stats.memory.percent}
                detail={`${stats.memory.used_gb} / ${stats.memory.total_gb} GB`}
                icon={<span>🧠</span>}
              />
              <MetricCard
                label="Disk"
                percent={stats.disk.percent}
                detail={`${stats.disk.used_gb} / ${stats.disk.total_gb} GB`}
                icon={<span>💾</span>}
              />
              <div className="card text-xs">
                <p className="text-gray-400 uppercase tracking-wider text-xs font-medium mb-2">Network</p>
                <p className="text-gray-200">↑ {stats.network.bytes_sent_mb.toFixed(1)} MB sent</p>
                <p className="text-gray-200">↓ {stats.network.bytes_recv_mb.toFixed(1)} MB recv</p>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card animate-pulse h-24 bg-gray-800" />
              ))}
            </div>
          )}

          {history.length > 1 && <HistoryChart data={history} />}

          {/* Token display */}
          {sessionUsage.total_tokens > 0 && (
            <TokenDisplay usage={lastUsage} model={model} sessionTotal={sessionUsage} />
          )}
        </aside>

        {/* Main: chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Settings drawer */}
          {showSettings && (
            <div className="border-b border-gray-800 bg-gray-900/80 p-4 flex flex-wrap gap-6">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-gray-800 text-gray-100 text-sm px-2 py-1.5 rounded-lg border border-gray-700"
                >
                  {MODELS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="min-w-48">
                <label className="text-xs text-gray-400 block mb-1">
                  Temperature: {temperature.toFixed(1)}
                </label>
                <input
                  type="range" min={0} max={1} step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(+e.target.value)}
                  className="w-full accent-indigo-500"
                />
              </div>
              <div className="flex-1 min-w-64">
                <ToolPanel
                  tools={tools}
                  enabled={enabledTools}
                  onChange={(name, on) => {
                    setEnabledTools((prev) => {
                      const next = new Set(prev);
                      on ? next.add(name) : next.delete(name);
                      return next;
                    });
                  }}
                />
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Quick prompts */}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setInput(p); }}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-full border border-gray-700 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-100"
                  } ${msg.isStreaming ? "typing" : ""}`}
                >
                  {msg.content || (msg.isStreaming ? "" : "...")}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-800 p-4">
            <div className="flex gap-3 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about CPU, memory, processes, logs…"
                rows={2}
                disabled={isThinking}
                className="flex-1 bg-gray-800 text-gray-100 placeholder-gray-500 text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={isThinking || !input.trim()}
                className="btn-primary h-11 px-5"
              >
                {isThinking ? "…" : "Send"}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1.5 text-center">
              Shift+Enter for newline · Model: {model} · {enabledTools.size}/{tools.length} tools active
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
