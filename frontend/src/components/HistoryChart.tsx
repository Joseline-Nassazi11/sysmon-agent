"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

interface DataPoint {
  time: string;
  cpu: number;
  memory: number;
}

interface HistoryChartProps {
  data: DataPoint[];
}

export default function HistoryChart({ data }: HistoryChartProps) {
  return (
    <div className="card">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
        Resource history (last 60s)
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#9ca3af" }}
            itemStyle={{ color: "#e5e7eb" }}
            formatter={(v: number) => [`${v.toFixed(1)}%`]}
          />
          <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Line
            type="monotone" dataKey="cpu" name="CPU"
            stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false}
          />
          <Line
            type="monotone" dataKey="memory" name="Memory"
            stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-3 h-0.5 bg-indigo-400 inline-block rounded" /> CPU
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-3 h-0.5 bg-cyan-400 inline-block rounded" /> Memory
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-3 h-0.5 bg-amber-400 inline-block rounded opacity-50 border-dashed border-t border-amber-400" /> 80% threshold
        </span>
      </div>
    </div>
  );
}
