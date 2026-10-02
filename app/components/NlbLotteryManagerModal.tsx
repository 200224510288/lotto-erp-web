"use client";

import { useEffect, useState } from "react";
import {
  NlbLotteryEntry,
  loadNlbLotteries,
  saveNlbLottery,
  deleteNlbLottery,
  resetNlbLotteriesToDefaults,
} from "../lib/nlbLotteryConfig";
import {
  X,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  Check,
  AlertCircle,
  HelpCircle,
  Ticket,
} from "lucide-react";

interface NlbLotteryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLotteriesUpdated?: (updatedCodes: string[]) => void;
}

export default function NlbLotteryManagerModal({
  isOpen,
  onClose,
  onLotteriesUpdated,
}: NlbLotteryManagerModalProps) {
  const [lotteries, setLotteries] = useState<NlbLotteryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCode, setEditingCode] = useState<string | null>(null);

  // Form states
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [aliasesStr, setAliasesStr] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  async function loadData() {
    setLoading(true);
    try {
      const list = await loadNlbLotteries();
      setLotteries(list);
    } catch {
      setFeedback({ type: "error", text: "Failed to load NLB lotteries." });
    } finally {
      setLoading(false);
    }
  }

  function handleStartAdd() {
    setEditingCode("NEW");
    setCode("");
    setName("");
    setAliasesStr("");
    setIsActive(true);
    setFeedback(null);
  }

  function handleStartEdit(item: NlbLotteryEntry) {
    setEditingCode(item.code);
    setCode(item.code);
    setName(item.name);
    setAliasesStr((item.aliases || []).join(", "));
    setIsActive(item.isActive);
    setFeedback(null);
  }

  function handleCancelForm() {
    setEditingCode(null);
    setCode("");
    setName("");
    setAliasesStr("");
    setIsActive(true);
    setFeedback(null);
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();

    if (!cleanCode) {
      setFeedback({ type: "error", text: "Lottery code is required (e.g. MSE)." });
      return;
    }
    if (!/^[A-Z0-9]{2,6}$/.test(cleanCode)) {
      setFeedback({
        type: "error",
        text: "Lottery code must be 2-6 alphanumeric characters (e.g. MSE, ADE).",
      });
      return;
    }
    if (!cleanName) {
      setFeedback({ type: "error", text: "Lottery name is required." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const aliases = aliasesStr
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0 && s !== cleanCode);

    try {
      const payload: NlbLotteryEntry = {
        code: cleanCode,
        name: cleanName,
        aliases,
        isActive,
      };

      const updated = await saveNlbLottery(payload);
      setLotteries(updated);
      setFeedback({
        type: "success",
        text: `NLB Lottery '${cleanCode}' saved successfully.`,
      });
      setEditingCode(null);
      if (onLotteriesUpdated) {
        onLotteriesUpdated(updated.filter((l) => l.isActive).map((l) => l.code));
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save NLB lottery.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleActive(item: NlbLotteryEntry) {
    setIsSubmitting(true);
    try {
      const updated = await saveNlbLottery({
        ...item,
        isActive: !item.isActive,
      });
      setLotteries(updated);
      if (onLotteriesUpdated) {
        onLotteriesUpdated(updated.filter((l) => l.isActive).map((l) => l.code));
      }
    } catch {
      setFeedback({ type: "error", text: "Failed to update status." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(targetCode: string) {
    setIsSubmitting(true);
    try {
      const updated = await deleteNlbLottery(targetCode);
      setLotteries(updated);
      setConfirmDeleteCode(null);
      setFeedback({ type: "success", text: `Removed lottery code '${targetCode}'.` });
      if (editingCode === targetCode) setEditingCode(null);
      if (onLotteriesUpdated) {
        onLotteriesUpdated(updated.filter((l) => l.isActive).map((l) => l.code));
      }
    } catch {
      setFeedback({ type: "error", text: "Failed to delete lottery." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetDefaults() {
    if (
      !confirm(
        "Are you sure you want to reset all NLB lotteries to default? Custom lotteries will be removed."
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      const defs = await resetNlbLotteriesToDefaults();
      setLotteries(defs);
      setEditingCode(null);
      setFeedback({
        type: "success",
        text: "Restored all default NLB lottery games.",
      });
      if (onLotteriesUpdated) {
        onLotteriesUpdated(defs.filter((l) => l.isActive).map((l) => l.code));
      }
    } catch {
      setFeedback({ type: "error", text: "Failed to reset NLB lotteries." });
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
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-teal-800 text-white flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center text-white shadow-inner">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                NLB Lottery Games Manager
                <span className="text-[10px] font-semibold bg-white/20 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Live Sync
                </span>
              </h2>
              <p className="text-xs text-teal-100/90 mt-0.5">
                Manage allowed NLB lottery report codes, names, and legacy aliases for automated processing.
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
                Allowed NLB Lotteries ({lotteries.length})
              </span>
              <p className="text-[11px] text-slate-500">
                Files matching these codes will be accepted in Sales Summary and Purchase dropzones.
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
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 active:bg-teal-800 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add NLB Lottery
              </button>
            </div>
          </div>

          {/* Add / Edit Form Modal Sub-view */}
          {editingCode !== null ? (
            <form
              onSubmit={handleSubmitForm}
              className="p-5 rounded-xl border-2 border-teal-200 bg-teal-50/40 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-teal-200 pb-2">
                <h3 className="text-sm font-bold text-teal-900 flex items-center gap-2">
                  {editingCode === "NEW" ? (
                    <>
                      <Plus className="w-4 h-4 text-teal-600" />
                      Add New NLB Lottery
                    </>
                  ) : (
                    <>
                      <Edit2 className="w-4 h-4 text-teal-600" />
                      Edit Lottery: {editingCode}
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lottery Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. MSE, ADE, WSE"
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-hidden font-mono font-bold uppercase text-slate-900"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">2-6 letters (e.g. MSE)</p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lottery Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Mahajana Sampatha, Wasi Wasana"
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-hidden text-slate-900 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Legacy / Shorthand Aliases
                  <span className="text-[10px] text-slate-400 font-normal ml-1">
                    (Comma-separated, e.g. MSM, MST)
                  </span>
                </label>
                <input
                  type="text"
                  value={aliasesStr}
                  onChange={(e) => setAliasesStr(e.target.value.toUpperCase())}
                  placeholder="e.g. MSM, MP1"
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-hidden font-mono text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="nlb-active-toggle"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <label
                  htmlFor="nlb-active-toggle"
                  className="text-xs text-slate-700 font-semibold cursor-pointer"
                >
                  Active for file uploads & validation
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-teal-200">
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
                  className="px-5 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmitting ? "Saving..." : "Save NLB Lottery"}
                </button>
              </div>
            </form>
          ) : null}

          {/* Lotteries Table List */}
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
              Loading NLB lotteries...
            </div>
          ) : lotteries.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed border-slate-200 rounded-xl">
              <p className="text-xs text-slate-500 mb-2">No NLB lotteries configured.</p>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-3 py-1.5 text-xs font-bold text-teal-600 hover:underline"
              >
                Load Default NLB Lotteries
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 text-left w-24">Code</th>
                    <th className="py-2.5 px-3 text-left">Lottery Name</th>
                    <th className="py-2.5 px-3 text-left">Aliases</th>
                    <th className="py-2.5 px-3 text-center w-24">Status</th>
                    <th className="py-2.5 px-3 text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lotteries.map((item) => {
                    const isDeleting = confirmDeleteCode === item.code;

                    return (
                      <tr
                        key={item.code}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          editingCode === item.code ? "bg-teal-50/50" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-teal-800">
                          <span className="bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded font-mono text-xs">
                            {item.code}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {item.name}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.aliases && item.aliases.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {item.aliases.map((a) => (
                                <span
                                  key={a}
                                  className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(item)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                              item.isActive
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                            }`}
                          >
                            {item.isActive ? "Active" : "Disabled"}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isDeleting ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-[11px] text-rose-600 font-semibold">
                                Del?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(item.code)}
                                className="px-2 py-0.5 bg-rose-600 text-white text-[11px] font-bold rounded hover:bg-rose-700"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCode(null)}
                                className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[11px] rounded hover:bg-slate-300"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(item)}
                                className="px-2 py-1 text-slate-600 hover:text-teal-600 hover:bg-teal-50 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                                title="Edit lottery"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCode(item.code)}
                                className="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                                title="Delete lottery"
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
            <HelpCircle className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">
                How NLB Report Detection Works:
              </span>
              <p className="mt-0.5 text-[11px] text-slate-500">
                When you drag and drop Excel reports into the NLB Sales or Purchase dropzones, the filename code (e.g. <code>MSE.xls</code>, <code>WSE_stock.xlsx</code>) is matched against these codes and aliases.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono text-[11px]">
            Active Codes: {lotteries.filter((l) => l.isActive).map((l) => l.code).join(", ")}
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
