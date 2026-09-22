"use client";

import { useEffect, useState } from "react";
import {
  getNlbAgentAliases,
  updateNlbAgentAliases,
  formatNlbAgentCode,
} from "@/app/lib/nlbAgentConfig";

export default function NlbAgentAliasEditor() {
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const [aliasInput, setAliasInput] = useState("");
  const [mapInput, setMapInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getNlbAgentAliases();
        setAliases(data);
      } catch (err) {
        console.error("Failed to load NLB agent aliases:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function addAlias() {
    setErrorMsg(null);
    const formattedAlias = formatNlbAgentCode(aliasInput);
    const formattedMap = formatNlbAgentCode(mapInput);

    if (!formattedAlias || formattedAlias.length < 5) {
      setErrorMsg("Alias code is invalid (e.g. N040064 or 040064).");
      return;
    }
    if (!formattedMap || formattedMap.length < 5) {
      setErrorMsg("Target code is invalid (e.g. N012345 or 012345).");
      return;
    }
    if (formattedAlias === formattedMap) {
      setErrorMsg("Alias and Target cannot be identical.");
      return;
    }

    try {
      setIsUpdating(true);
      const updated = { ...aliases, [formattedAlias]: formattedMap };
      await updateNlbAgentAliases(updated);
      setAliases(updated);
      setAliasInput("");
      setMapInput("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save alias.";
      setErrorMsg(msg);
    } finally {
      setIsUpdating(false);
    }
  }

  async function removeAlias(code: string) {
    try {
      setIsUpdating(true);
      const updated = { ...aliases };
      delete updated[code];
      await updateNlbAgentAliases(updated);
      setAliases(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete alias.";
      setErrorMsg(msg);
    } finally {
      setIsUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-teal-100 p-4 rounded-xl bg-white shadow-2xs text-xs text-gray-500">
        Loading NLB agent aliases...
      </div>
    );
  }

  const entries = Object.entries(aliases);

  return (
    <div className="border border-gray-200 p-4 rounded-xl bg-white shadow-2xs space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-xs text-gray-900 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal-600"></span>
            NLB Agent Aliases Mapping
          </h3>
          <p className="text-[11px] text-gray-500">
            Map incoming NLB agent codes to their primary agent code automatically.
          </p>
        </div>
        <span className="text-[11px] font-medium text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
          {entries.length} configured
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Alias (e.g. N040064 or 040064)"
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAlias()}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-mono w-44 uppercase focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
        />
        <span className="text-gray-400 font-bold text-xs">→</span>
        <input
          type="text"
          placeholder="Maps To (e.g. N012345 or 012345)"
          value={mapInput}
          onChange={(e) => setMapInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAlias()}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-mono w-44 uppercase focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
        />
        <button
          type="button"
          onClick={addAlias}
          disabled={isUpdating}
          className="bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
        >
          {isUpdating ? "Saving..." : "Add"}
        </button>
      </div>

      {errorMsg && (
        <p className="text-[11px] font-medium text-rose-600">
          {errorMsg}
        </p>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
        <table className="text-xs w-full text-left">
          <thead className="bg-gray-50 text-gray-700 font-medium border-b border-gray-200 sticky top-0">
            <tr>
              <th className="px-3 py-2">Alias Code</th>
              <th className="px-3 py-2">Maps To (Target)</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map(([alias, target]) => (
              <tr key={alias} className="hover:bg-gray-50/70 transition-colors">
                <td className="px-3 py-1.5 font-mono text-gray-800">{alias}</td>
                <td className="px-3 py-1.5 font-mono font-semibold text-teal-800">{target}</td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => removeAlias(alias)}
                    disabled={isUpdating}
                    className="text-rose-600 hover:text-rose-800 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-center text-gray-400 italic">
                  No NLB agent alias mappings configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
