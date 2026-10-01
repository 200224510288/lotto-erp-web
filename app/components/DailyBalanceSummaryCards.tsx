// app/components/DailyBalanceSummaryCards.tsx
"use client";

import React from "react";
import {
  Banknote,
  Trophy,
  Scale,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  Calendar,
  AlertCircle,
  FileText,
} from "lucide-react";
import {
  formatCurrency,
  formatDisplayDate,
  DailyBalanceReport,
  BalancingProgressSummary,
} from "../lib/balanceOrganizerService";
import { BigPrizeSummary } from "../lib/bigPrizeTicketsService";

interface DailyBalanceSummaryCardsProps {
  report: DailyBalanceReport | null;
  progress: BalancingProgressSummary;
  selectedDate: string;
  bigPrizeSummary?: BigPrizeSummary | null;
}

export default function DailyBalanceSummaryCards({
  report,
  progress,
  selectedDate,
  bigPrizeSummary,
}: DailyBalanceSummaryCardsProps) {
  if (!report) {
    return null;
  }

  const isBalancePositive = progress.totalBalance >= 0;

  return (
    <div className="space-y-4">
      {/* ===== Daily Meta Bar ===== */}
      <div className="rounded-lg border border-slate-300 bg-slate-50 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700 shadow-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 font-medium">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span>Balance Date:</span>
            <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-300">
              {report.balanceDate}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Uploaded File:</span>
            <span className="font-semibold text-slate-900 max-w-[220px] truncate" title={report.originalFileName}>
              {report.originalFileName}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-500">
            <span>Uploaded:</span>
            <span>{formatDisplayDate(report.uploadedAt)}</span>
            {report.uploadedBy && (
              <span className="text-slate-600">by <b>{report.uploadedBy}</b></span>
            )}
          </div>
        </div>

        {/* Checked status badge & Big Prize Badge */}
        <div className="flex flex-wrap items-center gap-2.5">
          {bigPrizeSummary && bigPrizeSummary.totalCount > 0 && (
            <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-900 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-300 shadow-2xs font-medium">
              <Trophy className="w-4 h-4 text-amber-600" />
              <span>Big Prize:</span>
              <span className="font-mono font-bold text-amber-950 text-sm sm:text-base">
                {formatCurrency(bigPrizeSummary.totalClaimAmount)}
              </span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  bigPrizeSummary.pendingCount === 0
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-200/80 text-amber-900"
                }`}
              >
                {bigPrizeSummary.scannedCount}/{bigPrizeSummary.totalCount} Scanned
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-slate-600 font-medium">Checking Status:</span>
            <span
              className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1.5 border shadow-xs ${
                progress.pendingRecords === 0
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : progress.checkedRecords > 0
                  ? "bg-amber-100 text-amber-900 border-amber-300"
                  : "bg-slate-200 text-slate-800 border-slate-300"
              }`}
            >
              {progress.pendingRecords === 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <Clock className="w-4 h-4 text-amber-600" />
              )}
              <span>
                {progress.checkedRecords} / {progress.totalRecords} Checked
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ===== 4 Large Summary Cards ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total CASH & CHE. */}
        <div className="relative overflow-hidden rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-800">
              Total CASH &amp; CHE.
            </span>
            <div className="rounded-lg bg-teal-100 p-2 text-teal-700">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-teal-950 font-mono">
            {formatCurrency(progress.totalCashAndCheque)}
          </div>
          <div className="mt-1 text-[11px] text-teal-700 font-medium">
            Daily total collected in cash &amp; cheques
          </div>
        </div>

        {/* Total WIN */}
        <div className="relative overflow-hidden rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-800">
              Total WIN
            </span>
            <div className="rounded-lg bg-purple-100 p-2 text-purple-700">
              <Trophy className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-purple-950 font-mono">
            {formatCurrency(progress.totalWin)}
          </div>
          <div className="mt-1 text-[11px] text-purple-700 font-medium">
            Daily total ticket winning prizes
          </div>
        </div>

        {/* Total Balance */}
        <div
          className={`relative overflow-hidden rounded-xl border p-4 shadow-sm transition hover:shadow-md ${
            isBalancePositive
              ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-white"
              : "border-rose-300 bg-gradient-to-br from-rose-50 to-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                isBalancePositive ? "text-emerald-900" : "text-rose-900"
              }`}
            >
              Total Balance (Total Money)
            </span>
            <div
              className={`rounded-lg p-2 ${
                isBalancePositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Scale className="w-5 h-5" />
            </div>
          </div>
          <div
            className={`mt-3 text-2xl font-bold tracking-tight font-mono ${
              isBalancePositive ? "text-emerald-950" : "text-rose-950"
            }`}
          >
            {formatCurrency(progress.totalBalance)}
          </div>
          <div
            className={`mt-1 text-[11px] font-medium ${
              isBalancePositive ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            Total CASH &amp; CHE. + Total WIN
          </div>
        </div>

        {/* Total Records */}
        <div className="relative overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-800">
              Total Records
            </span>
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-blue-950 font-mono">
            {progress.totalRecords.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-blue-700 font-medium">
            Excel records (1-by-1 balancing)
          </div>
        </div>
      </div>

      {/* ===== Second Section: Balancing Progress Breakdown ===== */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Verification Progress Breakdown
            </span>
            <span className="text-xs text-slate-500">
              ({progress.checkedRecords} of {progress.totalRecords} verified)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 font-mono">
              {progress.percentChecked}%
            </span>
            <div className="w-32 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percentChecked}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {/* Checked CASH & CHE. */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
            <div className="text-[11px] text-emerald-800 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Checked CASH &amp; CHE.</span>
            </div>
            <div className="mt-1 text-sm font-bold text-emerald-950 font-mono">
              {formatCurrency(progress.checkedCashAndCheque)}
            </div>
          </div>

          {/* Checked WIN */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
            <div className="text-[11px] text-emerald-800 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Checked WIN</span>
            </div>
            <div className="mt-1 text-sm font-bold text-emerald-950 font-mono">
              {formatCurrency(progress.checkedWin)}
            </div>
          </div>

          {/* Pending CASH & CHE. */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <div className="text-[11px] text-amber-800 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-600" />
              <span>Pending CASH &amp; CHE.</span>
            </div>
            <div className="mt-1 text-sm font-bold text-amber-950 font-mono">
              {formatCurrency(progress.pendingCashAndCheque)}
            </div>
          </div>

          {/* Pending WIN */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <div className="text-[11px] text-amber-800 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-600" />
              <span>Pending WIN</span>
            </div>
            <div className="mt-1 text-sm font-bold text-amber-950 font-mono">
              {formatCurrency(progress.pendingWin)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
