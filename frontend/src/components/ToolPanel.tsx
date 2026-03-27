"use client";

import { Tool } from "@/lib/api";

interface ToolPanelProps {
  tools: Tool[];
  enabled: Set<string>;
  onChange: (name: string, on: boolean) => void;
}

const TOOL_ICONS: Record<string, string> = {
  get_cpu_stats: "⚙️",
  get_memory_stats: "🧠",
  get_disk_stats: "💾",
  get_network_stats: "🌐",
  list_processes: "📋",
  read_system_logs: "📄",
  get_system_info: "🖥️",
  get_public_ip_geolocation: "📍",
};

export default function ToolPanel({ tools, enabled, onChange }: ToolPanelProps) {
  return (
    <div className="card">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
        Agent tools
      </p>
      <div className="space-y-2">
        {tools.map((t) => (
          <label key={t.name} className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={enabled.has(t.name)}
              onChange={(e) => onChange(t.name, e.target.checked)}
              className="mt-0.5 accent-indigo-500"
            />
            <div>
              <p className="text-sm text-gray-200 group-hover:text-white transition-colors">
                {TOOL_ICONS[t.name] ?? "🔧"} {t.name.replace(/_/g, " ")}
              </p>
              <p className="text-xs text-gray-500 leading-tight mt-0.5 line-clamp-2">
                {t.description.split(".")[0]}
              </p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
