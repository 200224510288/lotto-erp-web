// app/components/SequentialBalanceChecker.tsx
"use client";

import React, { useEffect, useCallback } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import {
  formatCurrency,
  formatDisplayDate,
  BalanceRecordRow,
} from "../lib/balanceOrganizerService";

interface SequentialBalanceCheckerProps {
  rows: BalanceRecordRow[];
  currentIndex: number;
  onIndexChange: (newIndex: number) => void;
  onConfirmAndNext: (row: BalanceRecordRow) => Promise<void>;
  onToggleStatus: (row: BalanceRecordRow) => Promise<void>;
  onClose: () => void;
  isProcessing: boolean;
}

export default function SequentialBalanceChecker({
  rows,
  currentIndex,
  onIndexChange,
  onConfirmAndNext,
  onToggleStatus,
  onClose,
  isProcessing,
}: SequentialBalanceCheckerProps) {
  const totalRecords = rows.length;
  const currentRow = rows[currentIndex];

  // Helper to find next unchecked record
  const findNextUncheckedIndex = useCallback(
    (fromIdx: number): number => {
      for (let i = fromIdx + 1; i < rows.length; i++) {
        if (!rows[i].isChecked) return i;
      }
      for (let i = 0; i <= fromIdx; i++) {
        if (!rows[i].isChecked) return i;
      }
      return fromIdx; // All checked
    },
    [rows]
  );

  // Keyboard navigation shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is typing in an input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentIndex > 0) onIndexChange(currentIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentIndex < totalRecords - 1) onIndexChange(currentIndex + 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (currentRow && !isProcessing) {
          onConfirmAndNext(currentRow);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, totalRecords, currentRow, isProcessing, onConfirmAndNext, onIndexChange, onClose]);

  if (!currentRow) {
    return null;
  }

  const isBalancePositive = currentRow.balance >= 0;
  const checkedCount = rows.filter((r) => r.isChecked).length;
  const hasUncheckedRemaining = checkedCount < totalRecords;

  return (
    <div className="rounded-xl border border-slate-300 bg-white shadow-lg overflow-hidden transition-all">
      {/* Top Header */}
      <div className="bg-slate-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-wide">
              SEQUENTIAL VERIFICATION MODE
            </h2>
            <p className="text-[11px] text-slate-400">
              Focus mode: verify individual records one by one
            </p>
          </div>
        </div>

        {/* Counter and Exit */}
        <div className="flex items-center gap-3">
          <div className="rounded bg-slate-800 px-3 py-1 text-xs font-mono font-semibold text-emerald-400 border border-slate-700">
            Record {currentIndex + 1} of {totalRecords}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Exit sequential mode (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Progress Line */}
      <div className="w-full bg-slate-100 h-1.5 overflow-hidden">
        <div
          className="bg-emerald-500 h-1.5 transition-all duration-200"
          style={{ width: `${((currentIndex + 1) / totalRecords) * 100}%` }}
        />
      </div>

      {/* Main Card Content */}
      <div className="p-6 md:p-8 space-y-6">
        {/* Serial No & Agent Info */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Serial / Account Number
            </span>
            <div className="text-xl font-bold font-mono text-slate-900 mt-0.5">
              {currentRow.serialNo || "-"}
            </div>
          </div>

          <div className="flex-1 min-w-[240px] text-left md:text-center">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Agent Name
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">
              {currentRow.agentName}
            </div>
          </div>

          {/* Current Row Status Badge */}
          <div className="text-right">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
              Current Status
            </span>
            {currentRow.isChecked ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>VERIFIED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>PENDING</span>
              </span>
            )}
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* WIN */}
          <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-800">
              WIN
            </span>
            <div className="mt-2 text-2xl font-bold font-mono text-purple-950">
              {formatCurrency(currentRow.win)}
            </div>
            <span className="text-[11px] text-purple-600 mt-1 block">
              Winning prize deduction
            </span>
          </div>

          {/* CASH & CHE. */}
          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4 text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-800">
              CASH &amp; CHE.
            </span>
            <div className="mt-2 text-2xl font-bold font-mono text-teal-950">
              {formatCurrency(currentRow.cashAndCheque)}
            </div>
            <span className="text-[11px] text-teal-600 mt-1 block">
              Collected amount
            </span>
          </div>

          {/* Balance */}
          <div
            className={`rounded-xl border p-4 text-center ${
              isBalancePositive
                ? "border-emerald-300 bg-emerald-50/60"
                : "border-rose-300 bg-rose-50/60"
            }`}
          >
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                isBalancePositive ? "text-emerald-900" : "text-rose-900"
              }`}
            >
              Calculated Balance
            </span>
            <div
              className={`mt-2 text-2xl font-bold font-mono ${
                isBalancePositive ? "text-emerald-950" : "text-rose-950"
              }`}
            >
              {formatCurrency(currentRow.balance)}
            </div>
            <span
              className={`text-[11px] mt-1 block font-medium ${
                isBalancePositive ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              CASH &amp; CHE. + WIN
            </span>
          </div>
        </div>

        {/* Verification Audit Footnote if Checked */}
        {currentRow.isChecked && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>
              Verified by <b>{currentRow.checkedBy || "Authorized Officer"}</b> at{" "}
              {formatDisplayDate(currentRow.checkedAt)}
            </span>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          {/* Previous Button */}
          <button
            type="button"
            disabled={currentIndex === 0 || isProcessing}
            onClick={() => onIndexChange(currentIndex - 1)}
            className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1.5 transition"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Previous</span>
            <span className="hidden sm:inline text-slate-400 text-[10px]">(←)</span>
          </button>

          {/* Primary Confirm & Next Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => onConfirmAndNext(currentRow)}
              className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-sm font-bold shadow-md flex items-center gap-2 transition disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <span className="animate-spin inline-block">⏳</span>
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Check className="w-5 h-5 stroke-[2.5]" />
                  <span>✓ Confirm &amp; Next</span>
                  <span className="text-emerald-200 text-xs font-normal">(Enter)</span>
                </>
              )}
            </button>

            {currentRow.isChecked && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onToggleStatus(currentRow)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-600 hover:text-red-700 hover:border-red-300 transition"
                title="Mark this record as pending (Undo check)"
              >
                Undo Check
              </button>
            )}
          </div>

          {/* Next Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentIndex >= totalRecords - 1 || isProcessing}
              onClick={() => onIndexChange(currentIndex + 1)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1.5 transition"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
              <span className="hidden sm:inline text-slate-400 text-[10px]">(→)</span>
            </button>

            {hasUncheckedRemaining && (
              <button
                type="button"
                onClick={() => {
                  const nextUnchecked = findNextUncheckedIndex(currentIndex);
                  onIndexChange(nextUnchecked);
                }}
                className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 font-medium transition flex items-center gap-1"
                title="Jump to next pending record"
              >
                <span>Jump Unchecked</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Keyboard tips footer */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-4">
          <span>Shortcuts:</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 border text-slate-600">Enter</kbd> Confirm &amp; Next</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 border text-slate-600">←</kbd> Previous</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 border text-slate-600">→</kbd> Next</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 border text-slate-600">Esc</kbd> Exit</span>
        </div>
      </div>
    </div>
  );
}
