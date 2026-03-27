"use client";

import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import clsx from "clsx";

interface MetricCardProps {
  label: string;
  percent: number;
  detail: string;
  icon: React.ReactNode;
}

function statusColor(pct: number) {
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  return "#6366f1";
}

export default function MetricCard({ label, percent, detail, icon }: MetricCardProps) {
  const color = statusColor(percent);
  const data = [{ value: percent, fill: color }];

  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-gray-500" style={{ fontSize: 16 }}>{icon}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative" style={{ width: 72, height: 72 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%" cy="50%"
              innerRadius="65%" outerRadius="100%"
              startAngle={90} endAngle={-270}
              data={data}
              barSize={8}
            >
              <RadialBar dataKey="value" background={{ fill: "#1f2937" }} cornerRadius={4} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color }}>
              {Math.round(percent)}%
            </span>
          </div>
        </div>
        <div>
          <p className="text-xl font-bold text-gray-100">{Math.round(percent)}%</p>
          <p className="text-xs text-gray-400 mt-0.5">{detail}</p>
          <span
            className={clsx("badge mt-1", {
              "bg-red-950 text-red-400": percent >= 90,
              "bg-amber-950 text-amber-400": percent >= 75 && percent < 90,
              "bg-indigo-950 text-indigo-400": percent < 75,
            })}
          >
            {percent >= 90 ? "Critical" : percent >= 75 ? "Warning" : "Healthy"}
          </span>
        </div>
      </div>
    </div>
  );
}
