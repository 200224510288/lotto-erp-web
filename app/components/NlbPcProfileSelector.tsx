"use client";

import { useEffect, useState, useRef } from "react";
import {
  NlbPcProfile,
  loadPcProfiles,
  savePcProfiles,
  addPcProfile,
  removePcProfile,
} from "../lib/nlbPcProfileConfig";
import { Monitor, Settings, Plus, Trash2, X, Check, CheckSquare, Square, Download } from "lucide-react";

interface NlbPcProfileSelectorProps {
  /** All available NLB lottery codes (active ones from config) */
  availableCodes: string[];
  /** Called when user clicks a PC or clears selection — provides assigned codes and profileId */
  onSelectProfile: (codes: string[], profileId: string | null) => void;
  /** Currently selected PC id (for highlight) */
  activePcId?: string | null;
  /** Color theme for accents: "teal" for sales, "indigo" for purchase */
  colorTheme?: "teal" | "indigo";
  /** Total count of selected files ready to download */
  selectedCount?: number;
  /** Callback triggered when user clicks the Download button in the PC bar */
  onDownload?: () => void;
  /** Whether downloading is currently in progress */
  isDownloading?: boolean;
}

export default function NlbPcProfileSelector({
  availableCodes,
  onSelectProfile,
  activePcId,
  colorTheme = "teal",
  selectedCount = 0,
  onDownload,
  isDownloading = false,
}: NlbPcProfileSelectorProps) {
  const [profiles, setProfiles] = useState<NlbPcProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [newPcName, setNewPcName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const settingsRef = useRef<HTMLDivElement>(null);

  const isTeal = colorTheme === "teal";
  const activeBtnClass = isTeal
    ? "bg-teal-600 text-white border-teal-700 shadow-xs"
    : "bg-indigo-600 text-white border-indigo-700 shadow-xs";
  const hoverBtnClass = isTeal
    ? "hover:bg-teal-50 hover:border-teal-400 hover:text-teal-700"
    : "hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700";
  const badgeColorClass = isTeal ? "text-teal-200" : "text-indigo-200";
  const gearActiveBg = isTeal ? "bg-teal-100 text-teal-700" : "bg-indigo-100 text-indigo-700";
  const primaryBg = isTeal ? "bg-teal-600 hover:bg-teal-700" : "bg-indigo-600 hover:bg-indigo-700";
  const iconColor = isTeal ? "text-teal-600" : "text-indigo-600";

  useEffect(() => {
    loadPcProfiles()
      .then(setProfiles)
      .finally(() => setLoading(false));
  }, []);

  // Close settings on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setIsSettingsOpen(false);
        setEditingProfileId(null);
        setRenamingId(null);
      }
    }
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isSettingsOpen]);

  async function handleAddPc() {
    const name = newPcName.trim() || `PC ${profiles.length + 1}`;
    const updated = await addPcProfile(name);
    setProfiles(updated);
    setNewPcName("");
  }

  async function handleRemovePc(id: string) {
    const updated = await removePcProfile(id);
    setProfiles(updated);
    if (editingProfileId === id) setEditingProfileId(null);
    if (activePcId === id) {
      onSelectProfile([], null);
    }
  }

  async function handleToggleCode(profileId: string, code: string) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    const has = profile.codes.includes(code);
    const newCodes = has
      ? profile.codes.filter((c) => c !== code)
      : [...profile.codes, code];

    const updated = profiles.map((p) =>
      p.id === profileId ? { ...p, codes: newCodes } : p
    );
    const saved = await savePcProfiles(updated);
    setProfiles(saved);

    // If this PC is currently active, sync live
    if (activePcId === profileId) {
      onSelectProfile(newCodes, profileId);
    }
  }

  async function handleSetAllCodes(profileId: string, selectAll: boolean) {
    const newCodes = selectAll ? [...availableCodes] : [];
    const updated = profiles.map((p) =>
      p.id === profileId ? { ...p, codes: newCodes } : p
    );
    const saved = await savePcProfiles(updated);
    setProfiles(saved);

    if (activePcId === profileId) {
      onSelectProfile(newCodes, profileId);
    }
  }

  async function handleRename(profileId: string) {
    const val = renamingValue.trim();
    if (!val) {
      setRenamingId(null);
      return;
    }
    const updated = profiles.map((p) =>
      p.id === profileId ? { ...p, name: val } : p
    );
    const saved = await savePcProfiles(updated);
    setProfiles(saved);
    setRenamingId(null);
  }

  function handleSelectPc(profile: NlbPcProfile) {
    if (activePcId === profile.id) {
      // Toggle off / reset to all
      onSelectProfile([], null);
    } else {
      onSelectProfile(profile.codes, profile.id);
    }
  }

  const activeProfile = profiles.find((p) => p.id === activePcId);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 py-0.5">
        <div className={`w-3.5 h-3.5 border-2 ${isTeal ? "border-teal-500" : "border-indigo-500"} border-t-transparent rounded-full animate-spin`} />
        Loading PC profiles…
      </div>
    );
  }

  return (
    <div className="relative" ref={settingsRef}>
      {/* Compact bar with PC selection on left and Download button on right */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left: PC Profile buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-gray-700 flex items-center gap-1 select-none">
            <Monitor className={`w-3.5 h-3.5 ${iconColor}`} />
            PC Quick Select:
          </span>

          {profiles.map((p) => {
            const isActive = activePcId === p.id;
            const count = p.codes.length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPc(p)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border cursor-pointer ${
                  isActive
                    ? activeBtnClass
                    : `bg-white text-gray-700 border-gray-300 ${hoverBtnClass}`
                }`}
                title={
                  count > 0
                    ? `${p.name}: ${p.codes.join(", ")} (Click to select files)`
                    : `${p.name}: No lotteries assigned (Click ⚙️ to configure)`
                }
              >
                {p.name}
                {count > 0 ? (
                  <span
                    className={`ml-1 text-[9px] font-mono ${
                      isActive ? badgeColorClass : "text-gray-400"
                    }`}
                  >
                    ({count})
                  </span>
                ) : (
                  <span className="ml-1 text-[9px] text-amber-500 font-medium">
                    (empty)
                  </span>
                )}
              </button>
            );
          })}

          {/* Clear selection / "All" button */}
          {activePcId && (
            <button
              type="button"
              onClick={() => onSelectProfile([], null)}
              className="px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 hover:bg-white cursor-pointer transition-colors"
              title="Clear selection — show all files"
            >
              All
            </button>
          )}

          {/* Settings gear button */}
          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen(!isSettingsOpen);
              setEditingProfileId(null);
              setRenamingId(null);
            }}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              isSettingsOpen
                ? gearActiveBg
                : "text-gray-400 hover:text-gray-600 hover:bg-black/5"
            }`}
            title="Configure PC lottery assignments"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Direct Download button & Status indicator */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Helper when selected PC has no codes */}
          {activeProfile && activeProfile.codes.length === 0 && (
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(true);
                setEditingProfileId(activeProfile.id);
              }}
              className="text-[11px] text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-semibold cursor-pointer animate-pulse"
              title="Click to assign lotteries to this PC"
            >
              ⚠️ {activeProfile.name} is empty — click to assign lotteries
            </button>
          )}

          {/* Helper when selected PC has codes but no files found for today */}
          {activeProfile && activeProfile.codes.length > 0 && selectedCount === 0 && (
            <span className="text-[10px] text-gray-500 bg-white/90 border border-gray-200 px-2 py-0.5 rounded">
              0 files matching {activeProfile.name} for this date
            </span>
          )}

          {/* Direct Download Button */}
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading || selectedCount === 0}
              className={`px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer ${
                selectedCount > 0
                  ? isTeal
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 ring-1 ring-emerald-700/20"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 ring-1 ring-indigo-700/20"
                  : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-60"
              }`}
              title={
                selectedCount > 0
                  ? `Download ${selectedCount} selected file(s) for ${activeProfile ? activeProfile.name : "selected PC"}`
                  : "Select a PC or check files below to download"
              }
            >
              {isDownloading ? (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>
                {isDownloading
                  ? "Downloading…"
                  : selectedCount > 0
                  ? `Download Selected (${selectedCount})`
                  : "Download (0)"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Settings dropdown panel */}
      {isSettingsOpen && (
        <div className="absolute left-0 top-full mt-1.5 z-40 w-[360px] bg-white border border-gray-200 rounded-xl shadow-xl p-3.5 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <Monitor className={`w-3.5 h-3.5 ${iconColor}`} />
              PC Lottery Profiles
            </h4>
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(false);
                setEditingProfileId(null);
              }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Profile list */}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {profiles.map((p) => {
              const isEditing = editingProfileId === p.id;
              return (
                <div
                  key={p.id}
                  className={`border rounded-lg p-2.5 transition-colors ${
                    isEditing
                      ? isTeal ? "border-teal-300 bg-teal-50/40" : "border-indigo-300 bg-indigo-50/40"
                      : "border-gray-200 bg-gray-50/60"
                  }`}
                >
                  {/* Profile header */}
                  <div className="flex items-center justify-between gap-1.5">
                    {renamingId === p.id ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={renamingValue}
                          onChange={(e) => setRenamingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(p.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className={`flex-1 px-2 py-0.5 text-[11px] border border-gray-300 rounded focus:ring-1 ${isTeal ? "focus:ring-teal-500" : "focus:ring-indigo-500"} focus:outline-none bg-white font-semibold`}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleRename(p.id)}
                          className={`p-1 ${iconColor} hover:opacity-80 cursor-pointer`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(p.id);
                          setRenamingValue(p.name);
                        }}
                        className={`text-[11px] font-bold text-gray-800 ${isTeal ? "hover:text-teal-700" : "hover:text-indigo-700"} cursor-pointer flex items-center gap-1`}
                        title="Click to rename"
                      >
                        {p.name}
                        <span className="text-[10px] text-gray-400 font-normal">✎</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingProfileId(isEditing ? null : p.id)
                        }
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${
                          isEditing
                            ? primaryBg + " text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        }`}
                      >
                        {isEditing ? "Done" : "Assign Lotteries"}
                      </button>
                      {profiles.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePc(p.id)}
                          className="p-1 text-gray-400 hover:text-red-500 cursor-pointer rounded"
                          title="Delete this PC"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Codes summary tags (when not editing) */}
                  {!isEditing && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.codes.length > 0 ? (
                        p.codes.map((c) => (
                          <span
                            key={c}
                            className={`px-1.5 py-0.5 ${isTeal ? "bg-teal-100 text-teal-800 border-teal-200" : "bg-indigo-100 text-indigo-800 border-indigo-200"} text-[10px] font-mono font-bold rounded border`}
                          >
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 italic">
                          No lotteries assigned — click "Assign Lotteries"
                        </span>
                      )}
                    </div>
                  )}

                  {/* Code assignment editor */}
                  {isEditing && (
                    <div className="mt-2 pt-2 border-t border-gray-200/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 font-medium">
                          Select lotteries handled by {p.name}:
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSetAllCodes(p.id, true)}
                            className={`text-[10px] ${iconColor} hover:underline font-semibold flex items-center gap-0.5 cursor-pointer`}
                          >
                            <CheckSquare className="w-2.5 h-2.5" /> All
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => handleSetAllCodes(p.id, false)}
                            className="text-[10px] text-gray-500 hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <Square className="w-2.5 h-2.5" /> Clear
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-1 max-h-36 overflow-y-auto">
                        {availableCodes.map((code) => {
                          const isAssigned = p.codes.includes(code);
                          return (
                            <label
                              key={code}
                              className={`flex items-center justify-center gap-1 px-1 py-1 rounded border text-[10px] font-mono font-bold cursor-pointer transition-colors select-none ${
                                isAssigned
                                  ? isTeal
                                    ? "bg-teal-600 border-teal-700 text-white shadow-2xs"
                                    : "bg-indigo-600 border-indigo-700 text-white shadow-2xs"
                                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-400 hover:bg-gray-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={() => handleToggleCode(p.id, code)}
                                className="sr-only"
                              />
                              {isAssigned && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              {code}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add new PC */}
          <div className="flex items-center gap-1.5 pt-1.5 border-t border-gray-100">
            <input
              type="text"
              value={newPcName}
              onChange={(e) => setNewPcName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddPc();
              }}
              placeholder={`PC ${profiles.length + 1} name…`}
              className={`flex-1 px-2.5 py-1 text-[11px] border border-gray-300 rounded-md ${isTeal ? "focus:ring-1 focus:ring-teal-500" : "focus:ring-1 focus:ring-indigo-500"} focus:outline-none bg-white`}
            />
            <button
              type="button"
              onClick={handleAddPc}
              className={`px-2.5 py-1 ${primaryBg} text-white text-[11px] font-semibold rounded-md flex items-center gap-1 cursor-pointer shadow-xs`}
            >
              <Plus className="w-3 h-3" />
              Add PC
            </button>
          </div>

          <p className="text-[10px] text-gray-400 leading-tight">
            💡 Tip: Click any PC button above to automatically select all its lottery files, then click Download.
          </p>
        </div>
      )}
    </div>
  );
}
