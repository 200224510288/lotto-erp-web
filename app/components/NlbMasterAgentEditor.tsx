"use client";

import { useEffect, useState } from "react";
import {
  getNlbMasterAgentCode,
  setNlbMasterAgentCode,
  formatNlbAgentCode,
} from "@/app/lib/nlbAgentConfig";

export default function NlbMasterAgentEditor() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const master = await getNlbMasterAgentCode();
        setCode(master);
      } catch (err) {
        console.error("Failed to load NLB master agent:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function save() {
    const formatted = formatNlbAgentCode(code);
    if (!formatted || formatted.length < 5) {
      setMessage({ type: "error", text: "Master agent code must be valid (e.g. N000000 or 000000)." });
      return;
    }

    try {
      setIsSaving(true);
      await setNlbMasterAgentCode(formatted);
      setCode(formatted);
      setMessage({ type: "success", text: `Master Agent Code saved: ${formatted}` });
      setTimeout(() => setMessage(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save master agent code.";
      setMessage({ type: "error", text: msg });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-teal-100 p-4 rounded-xl bg-white shadow-2xs text-xs text-gray-500">
        Loading NLB master agent...
      </div>
    );
  }

  return (
    <div className="border border-gray-200 p-4 rounded-xl bg-white shadow-2xs space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-xs text-gray-900 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-teal-600"></span>
          NLB Master Agent Code
        </h3>
        <span className="text-[10px] text-gray-400 font-mono">Collection: nlb_agent_config</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="e.g. N000000 or 000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="border border-gray-300 px-3 py-1.5 rounded-lg text-xs font-mono w-40 uppercase focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
        />
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>

      {message && (
        <p
          className={`text-[11px] font-medium ${
            message.type === "success" ? "text-emerald-700" : "text-rose-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
