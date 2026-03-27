"use client";

import { TokenUsage, calcCost } from "@/lib/api";

interface TokenDisplayProps {
  usage: TokenUsage;
  model: string;
  sessionTotal: TokenUsage;
}

export default function TokenDisplay({ usage, model, sessionTotal }: TokenDisplayProps) {
  const lastCost = calcCost(usage, model);
  const totalCost = calcCost(sessionTotal, model);

  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/50 text-xs">
      <p className="text-gray-400 font-medium mb-2 uppercase tracking-wider">Token usage</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <p className="text-gray-500">Last response</p>
          <p className="text-gray-200 font-mono">{usage.input_tokens}↑ {usage.output_tokens}↓</p>
          <p className="text-indigo-400 font-mono">${lastCost.toFixed(6)}</p>
        </div>
        <div>
          <p className="text-gray-500">Session total</p>
          <p className="text-gray-200 font-mono">{sessionTotal.total_tokens} tokens</p>
          <p className="text-indigo-400 font-mono">${totalCost.toFixed(5)}</p>
        </div>
      </div>
    </div>
  );
}
