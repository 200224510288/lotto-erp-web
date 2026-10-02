"use client";

import { useEffect, useState } from "react";
import {
  DlbGame,
  DlbWeekday,
  DLB_WEEKDAYS,
  STANDARD_WEEKDAY_SUFFIXES,
  loadDlbGames,
  saveDlbGame,
  deleteDlbGame,
  resetDlbGamesToDefaults,
  generateDefaultSchedule,
} from "../lib/dlbGameConfig";
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  RotateCcw,
  Check,
  AlertCircle,
  HelpCircle,
  Dices,
} from "lucide-react";

interface DlbLotteryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGamesUpdated?: () => void;
}

export default function DlbLotteryManagerModal({
  isOpen,
  onClose,
  onGamesUpdated,
}: DlbLotteryManagerModalProps) {
  const [games, setGames] = useState<DlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [days, setDays] = useState<Record<DlbWeekday, { erp: string; official: string }>>(
    generateDefaultSchedule("")
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load games on modal open
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  async function loadData() {
    setLoading(true);
    try {
      const list = await loadDlbGames();
      setGames(list);
    } catch {
      setFeedback({ type: "error", text: "Failed to load lottery games." });
    } finally {
      setLoading(false);
    }
  }

  function handleStartAdd() {
    setEditingId("NEW");
    setName("");
    setPrefix("");
    setDays(generateDefaultSchedule(""));
    setFeedback(null);
  }

  function handleStartEdit(game: DlbGame) {
    setEditingId(game.id);
    setName(game.name);
    setPrefix(game.prefix || "");
    setDays({ ...game.days });
    setFeedback(null);
  }

  function handleCancelForm() {
    setEditingId(null);
    setName("");
    setPrefix("");
    setDays(generateDefaultSchedule(""));
    setFeedback(null);
  }

  function handleAutoGenerateSchedule() {
    if (!prefix.trim()) {
      setFeedback({
        type: "error",
        text: "Please enter a base prefix (e.g. 'W' or 'SF') to generate codes.",
      });
      return;
    }
    const schedule = generateDefaultSchedule(prefix);
    setDays(schedule);
    setFeedback({
      type: "success",
      text: `Auto-generated weekly codes using prefix '${prefix.trim().toUpperCase()}'. Review and tweak below if needed.`,
    });
  }

  function handleDayChange(
    day: DlbWeekday,
    field: "erp" | "official",
    value: string
  ) {
    setDays((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value.toUpperCase(),
      },
    }));
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFeedback({ type: "error", text: "Game name is required." });
      return;
    }

    // Check that at least one day has both erp & official code
    const hasAnyValidDay = Object.values(days).some(
      (d) => d.erp.trim() && d.official.trim()
    );
    if (!hasAnyValidDay) {
      setFeedback({
        type: "error",
        text: "Please provide at least one valid ERP code and Official code.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const cleanName = name.trim();
      const cleanPrefix = prefix.trim().toUpperCase();
      const gameId =
        editingId && editingId !== "NEW"
          ? editingId
          : cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_");

      const gamePayload: DlbGame = {
        id: gameId,
        name: cleanName,
        prefix: cleanPrefix,
        days: { ...days },
      };

      const updatedList = await saveDlbGame(gamePayload);
      setGames(updatedList);
      setFeedback({
        type: "success",
        text: `Lottery '${cleanName}' saved successfully.`,
      });
      setEditingId(null);
      if (onGamesUpdated) onGamesUpdated();
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save game.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setIsSubmitting(true);
    try {
      const updatedList = await deleteDlbGame(id);
      setGames(updatedList);
      setConfirmDeleteId(null);
      setFeedback({ type: "success", text: "Game removed successfully." });
      if (editingId === id) setEditingId(null);
      if (onGamesUpdated) onGamesUpdated();
    } catch {
      setFeedback({ type: "error", text: "Failed to delete game." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetDefaults() {
    if (
      !confirm(
        "Are you sure you want to restore the built-in default DLB games? Any custom additions will be reset."
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      const defs = await resetDlbGamesToDefaults();
      setGames(defs);
      setEditingId(null);
      setFeedback({
        type: "success",
        text: "Restored all default DLB games and weekly mappings.",
      });
      if (onGamesUpdated) onGamesUpdated();
    } catch {
      setFeedback({ type: "error", text: "Failed to reset games." });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-white shadow-inner">
              <Dices className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                DLB Lottery Game Manager
                <span className="text-[10px] font-semibold bg-white/20 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Live Sync
                </span>
              </h2>
              <p className="text-xs text-blue-100/90 mt-0.5">
                Manage DLB lottery games and weekly ERP-to-Official draw code mappings without code changes.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-rose-50 text-rose-800 border-rose-200"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {feedback.type === "success" ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600" />
              )}
              {feedback.text}
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-xs underline hover:opacity-75"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Body Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Action Bar */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-700">
                Configured DLB Games ({games.length})
              </span>
              <p className="text-[11px] text-slate-500">
                Uploaded ERP files are automatically identified by matching these codes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1.5 transition-colors"
                title="Restore default games list"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={handleStartAdd}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add New Lottery
              </button>
            </div>
          </div>

          {/* Add / Edit Form Modal Sub-view */}
          {editingId !== null ? (
            <form
              onSubmit={handleSubmitForm}
              className="p-5 rounded-xl border-2 border-blue-200 bg-blue-50/40 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                  {editingId === "NEW" ? (
                    <>
                      <Plus className="w-4 h-4 text-blue-600" />
                      Add New DLB Lottery Game
                    </>
                  ) : (
                    <>
                      <Edit2 className="w-4 h-4 text-blue-600" />
                      Edit Lottery: {name || "Game"}
                    </>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-xs text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
              </div>

              {/* Game Metadata row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lottery Game Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Wasi, Lagna Wasana, Ada Kotipathi"
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-hidden text-slate-900 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    Base Code Prefix
                    <span className="text-[10px] text-slate-400 font-normal">
                      (e.g. W, SF, AK)
                    </span>
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                      placeholder="e.g. W"
                      className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-hidden font-mono text-slate-900 font-bold uppercase"
                    />
                    <button
                      type="button"
                      onClick={handleAutoGenerateSchedule}
                      className="px-2.5 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-bold rounded-lg border border-blue-300 flex items-center gap-1 whitespace-nowrap shadow-2xs"
                      title="Auto-fill 7 days from prefix"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      Auto 7-Days
                    </button>
                  </div>
                </div>
              </div>

              {/* 7-Days Schedule Grid */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Weekday Draw Codes Mapping
                  </span>
                  <span className="text-[11px] text-slate-500">
                    ERP Code matches filename → Maps to Official Code
                  </span>
                </div>

                <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-2xs">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3 text-left w-32">Weekday</th>
                        <th className="py-2 px-3 text-left">
                          ERP Code (In File Name)
                        </th>
                        <th className="py-2 px-3 text-left">
                          Official Code (System Code)
                        </th>
                        <th className="py-2 px-3 text-left text-slate-400 font-normal">
                          Preview
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {DLB_WEEKDAYS.map((day) => {
                        const dayData = days[day] || { erp: "", official: "" };
                        return (
                          <tr key={day} className="hover:bg-slate-50/60">
                            <td className="py-1.5 px-3 font-medium text-slate-800">
                              {day}
                            </td>
                            <td className="py-1.5 px-3">
                              <input
                                type="text"
                                value={dayData.erp}
                                onChange={(e) =>
                                  handleDayChange(day, "erp", e.target.value)
                                }
                                placeholder={`e.g. ${prefix ? prefix + STANDARD_WEEKDAY_SUFFIXES[day].erp : "CODE"}`}
                                className="w-full max-w-[140px] px-2.5 py-1 font-mono text-xs font-semibold uppercase bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 px-3">
                              <input
                                type="text"
                                value={dayData.official}
                                onChange={(e) =>
                                  handleDayChange(day, "official", e.target.value)
                                }
                                placeholder={`e.g. ${prefix ? prefix + STANDARD_WEEKDAY_SUFFIXES[day].official : "OFFICIAL"}`}
                                className="w-full max-w-[140px] px-2.5 py-1 font-mono text-xs font-semibold uppercase bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:ring-1 focus:ring-blue-500 text-blue-700"
                              />
                            </td>
                            <td className="py-1.5 px-3 text-slate-500 font-mono text-[11px]">
                              {dayData.erp && dayData.official ? (
                                <span className="inline-flex items-center gap-1 text-slate-700 font-semibold">
                                  <span>{dayData.erp}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-blue-600">
                                    {dayData.official}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">
                                  Not scheduled
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting ? "Saving..." : "Save Lottery Game"}
                </button>
              </div>
            </form>
          ) : null}

          {/* Games Table List */}
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Loading DLB games...
            </div>
          ) : games.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500 mb-2">No games configured.</p>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-3 py-1.5 text-xs font-bold text-blue-600 hover:underline"
              >
                Load Default DLB Games
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 text-left">Lottery Name</th>
                    <th className="py-2.5 px-2 text-center">Prefix</th>
                    <th className="py-2.5 px-3 text-left">Weekly Schedule (ERP → Official)</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {games.map((g) => {
                    const activeDays = DLB_WEEKDAYS.filter(
                      (d) => g.days?.[d]?.erp && g.days?.[d]?.official
                    );
                    const isDeleting = confirmDeleteId === g.id;

                    return (
                      <tr
                        key={g.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          editingId === g.id ? "bg-blue-50/50" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap">
                          {g.name}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {g.prefix ? (
                            <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {g.prefix}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1 max-w-xl">
                            {activeDays.length > 0 ? (
                              activeDays.map((d) => (
                                <span
                                  key={d}
                                  className="inline-flex items-center gap-1 font-mono text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded border border-slate-200/80 transition-colors"
                                  title={`${d}: ${g.days[d].erp} → ${g.days[d].official}`}
                                >
                                  <span className="text-slate-500 font-sans font-medium">
                                    {d.slice(0, 3)}:
                                  </span>
                                  <span className="font-semibold">{g.days[d].erp}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-blue-700 font-bold">
                                    {g.days[d].official}
                                  </span>
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 italic">
                                No weekday schedule
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isDeleting ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-[11px] text-rose-600 font-semibold">
                                Delete?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(g.id)}
                                className="px-2 py-0.5 bg-rose-600 text-white text-[11px] font-bold rounded hover:bg-rose-700"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[11px] rounded hover:bg-slate-300"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(g)}
                                className="px-2 py-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                                title="Edit game & schedules"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(g.id)}
                                className="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                                title="Remove game"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Helpful Information Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
            <HelpCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">
                How ERP Game Auto-Detection Works:
              </span>
              <p className="mt-0.5 text-[11px] text-slate-500">
                When you drag and drop summary Excel files onto the home page, the system matches the ERP code in the filename against the current business day. Saving changes here immediately updates detection across all connected cashiers and terminals.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono text-[11px]">
            Active Games: {games.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
