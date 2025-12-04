"use client";

import { useEffect, useState } from "react";
import {
  getDealerAliases,
  updateDealerAliases,
} from "@/app/lib/dealerConfig";

export default function DealerAliasEditor() {
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [aliasInput, setAliasInput] = useState("");
  const [mapInput, setMapInput] = useState("");

  useEffect(() => {
    async function load() {
      const data = await getDealerAliases();
      setAliases(data);
      setLoading(false);
    }
    load();
  }, []);

  async function addAlias() {
    if (aliasInput.length !== 6 || mapInput.length !== 6) {
      alert("Dealer codes must be 6 digits.");
      return;
    }

    const updated = { ...aliases, [aliasInput]: mapInput };
    await updateDealerAliases(updated);
    setAliases(updated);

    setAliasInput("");
    setMapInput("");
  }

  async function removeAlias(code: string) {
    const updated = { ...aliases };
    delete updated[code];

    await updateDealerAliases(updated);
    setAliases(updated);
  }

  if (loading) return <p>Loading dealer aliases...</p>;

  return (
    <div className="border p-4 rounded bg-white space-y-4">
      <h3 className="font-semibold text-sm">Dealer Aliases</h3>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Alias (030589)"
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-28"
        />
        <input
          type="text"
          placeholder="Maps To"
          value={mapInput}
          onChange={(e) => setMapInput(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-28"
        />
        <button
          onClick={addAlias}
          className="bg-blue-600 text-white text-sm px-3 rounded"
        >
          Add
        </button>
      </div>

      <table className="text-sm w-full border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-2 py-1 text-left">Alias</th>
            <th className="px-2 py-1 text-left">Maps To</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(aliases).map(([alias, target]) => (
            <tr key={alias} className="border-t">
              <td className="px-2 py-1">{alias}</td>
              <td className="px-2 py-1">{target}</td>
              <td className="px-2 py-1 text-right">
                <button
                  onClick={() => removeAlias(alias)}
                  className="text-red-600 text-xs"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {Object.keys(aliases).length === 0 && (
            <tr>
              <td colSpan={3} className="px-2 py-2 text-center text-gray-500">
                No aliases added.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
