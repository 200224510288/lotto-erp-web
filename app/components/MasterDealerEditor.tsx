"use client";

import { useEffect, useState } from "react";
import {
  getMasterDealerCode,
  setMasterDealerCode,
} from "@/app/lib/dealerConfig";

export default function MasterDealerEditor() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const master = await getMasterDealerCode();
      setCode(master);
      setLoading(false);
    }
    load();
  }, []);

  async function save() {
    if (code.length !== 6) {
      alert("Master dealer code must be exactly 6 digits.");
      return;
    }
    await setMasterDealerCode(code);
    alert("Master dealer updated.");
  }

  if (loading) return <p>Loading master dealer...</p>;

  return (
    <div className="border p-4 rounded bg-white space-y-3">
      <h3 className="font-semibold text-sm">Master Dealer Code</h3>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="border px-2 py-1 rounded text-sm w-28"
        />
        <button
          onClick={save}
          className="bg-green-600 text-white px-3 rounded text-sm"
        >
          Save
        </button>
      </div>
    </div>
  );
}
