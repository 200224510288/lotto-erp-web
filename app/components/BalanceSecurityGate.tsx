// app/components/BalanceSecurityGate.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Lock, Unlock, ShieldAlert, KeyRound, Check, X, ShieldCheck } from "lucide-react";
import {
  verifyBalancePasscode,
  updateBalancePasscode,
} from "../lib/balanceOrganizerService";

interface BalanceSecurityGateProps {
  userEmail: string;
  children: React.ReactNode;
  onLockStateChange?: (isLocked: boolean) => void;
  pageTitle?: string;
  pageSubtitle?: string;
  systemWarning?: string;
  badgeText?: string;
  unlockButtonText?: string;
  sessionStorageKey?: string;
}

const DEFAULT_SESSION_KEY = "lottocore_balance_security_unlocked";

export default function BalanceSecurityGate({
  userEmail,
  children,
  onLockStateChange,
  pageTitle = "DAILY BALANCE ORGANIZER",
  pageSubtitle = "Restricted Financial Balancing System",
  systemWarning = "This module handles office cash balancing and individual agent verification. Enter your authorized Balance Officer PIN to proceed.",
  badgeText = "L-2 SECURED",
  unlockButtonText,
  sessionStorageKey = DEFAULT_SESSION_KEY,
}: BalanceSecurityGateProps) {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [pinInput, setPinInput] = useState<string>("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Modal for changing PIN
  const [showChangePinModal, setShowChangePinModal] = useState<boolean>(false);
  const [currentPin, setCurrentPin] = useState<string>("");
  const [newPin, setNewPin] = useState<string>("");
  const [confirmNewPin, setConfirmNewPin] = useState<string>("");
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [changePinSuccess, setChangePinSuccess] = useState<string | null>(null);
  const [isUpdatingPin, setIsUpdatingPin] = useState<boolean>(false);

  useEffect(() => {
    // Check session storage (support shared key or specific key)
    try {
      const isSessionValid =
        sessionStorage.getItem(sessionStorageKey) === "true" ||
        sessionStorage.getItem(DEFAULT_SESSION_KEY) === "true" ||
        sessionStorage.getItem("lottocore_daily_balance_unlocked") === "true";
      if (isSessionValid) {
        setIsUnlocked(true);
        if (onLockStateChange) onLockStateChange(false);
      }
    } catch {
      // sessionStorage might be restricted
    } finally {
      setIsInitializing(false);
    }
  }, [onLockStateChange, sessionStorageKey]);

  async function handleUnlockSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setPinError(null);

    if (!pinInput.trim()) {
      setPinError("Please enter your Security PIN.");
      return;
    }

    setIsVerifying(true);
    try {
      const valid = await verifyBalancePasscode(pinInput);
      if (valid) {
        setIsUnlocked(true);
        try {
          sessionStorage.setItem(sessionStorageKey, "true");
          sessionStorage.setItem(DEFAULT_SESSION_KEY, "true");
        } catch {}
        setPinInput("");
        setPinError(null);
        if (onLockStateChange) onLockStateChange(false);
      } else {
        setPinError("Incorrect PIN. Access denied. (Default: 8899)");
      }
    } catch (err) {
      console.error("PIN verification error:", err);
      setPinError("Authentication service error. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleLockSession() {
    setIsUnlocked(false);
    setPinInput("");
    setPinError(null);
    try {
      sessionStorage.removeItem(sessionStorageKey);
      sessionStorage.removeItem(DEFAULT_SESSION_KEY);
      sessionStorage.removeItem("lottocore_daily_balance_unlocked");
      sessionStorage.removeItem("lottocore_scan_balancing_unlocked");
    } catch {}
    if (onLockStateChange) onLockStateChange(true);
  }

  async function handleChangePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChangePinError(null);
    setChangePinSuccess(null);

    if (!currentPin.trim()) {
      setChangePinError("Please enter current PIN.");
      return;
    }
    if (!newPin.trim() || newPin.trim().length < 4) {
      setChangePinError("New PIN must be at least 4 digits.");
      return;
    }
    if (newPin !== confirmNewPin) {
      setChangePinError("New PIN and confirmation do not match.");
      return;
    }

    setIsUpdatingPin(true);
    try {
      const result = await updateBalancePasscode(currentPin, newPin, userEmail);
      if (result.success) {
        setChangePinSuccess("Security PIN updated successfully!");
        setCurrentPin("");
        setNewPin("");
        setConfirmNewPin("");
        setTimeout(() => {
          setShowChangePinModal(false);
          setChangePinSuccess(null);
        }, 1500);
      } else {
        setChangePinError(result.message || "Failed to update PIN.");
      }
    } catch {
      setChangePinError("Error updating PIN. Please try again.");
    } finally {
      setIsUpdatingPin(false);
    }
  }

  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-700">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block animate-spin">⏳</span>
          <span>Verifying security clearance…</span>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#e5e7eb] px-4 py-8">
        <div className="w-full max-w-md border border-gray-400 bg-white shadow-xl">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-400 bg-[#1f2937] text-white flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-emerald-400" />
                <h1 className="text-lg font-bold tracking-wide">
                  {pageTitle}
                </h1>
              </div>
              <p className="text-[11px] text-gray-300 mt-0.5">
                {pageSubtitle}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
              {badgeText}
            </span>
          </div>

          {/* System Warning */}
          <div className="px-6 py-3 border-b border-amber-300 bg-amber-50 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-900 leading-snug">
              {systemWarning}
            </p>
          </div>

          {/* PIN Form */}
          <div className="px-6 py-6 space-y-5">
            {pinError && (
              <div className="border border-red-400 bg-red-50 p-2.5 text-[12px] text-red-800 flex items-center justify-between">
                <span>{pinError}</span>
                <button
                  type="button"
                  onClick={() => setPinError(null)}
                  className="text-red-600 hover:text-red-900 font-bold"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-gray-800 mb-1">
                  Balance Officer PIN / Passcode
                </label>
                <div className="relative">
                  <input
                    type="password"
                    maxLength={10}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="Enter 4-digit PIN (Default: 8899)"
                    autoFocus
                    className="w-full border border-gray-400 px-3 py-2 text-center text-lg tracking-widest font-mono bg-gray-50 focus:bg-white focus:outline-none focus:border-gray-800"
                  />
                  <KeyRound className="w-4 h-4 text-gray-400 absolute right-3 top-3 pointer-events-none" />
                </div>
                <div className="flex justify-between items-center mt-1.5 text-[11px] text-gray-500">
                  <span>Authorized user: <b>{userEmail || "Financial Officer"}</b></span>
                  <span className="text-gray-400 font-mono">Default: 8899</span>
                </div>
              </div>

              {/* Quick keypad */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => {
                      if (pinInput.length < 8) setPinInput((prev) => prev + digit);
                    }}
                    className="py-2 text-sm font-semibold rounded border border-gray-300 bg-gray-50 hover:bg-gray-200 text-gray-800 transition active:scale-95"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPinInput("")}
                  className="py-2 text-xs font-semibold rounded border border-gray-300 bg-red-50 hover:bg-red-100 text-red-700 transition"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pinInput.length < 8) setPinInput((prev) => prev + "0");
                  }}
                  className="py-2 text-sm font-semibold rounded border border-gray-300 bg-gray-50 hover:bg-gray-200 text-gray-800 transition active:scale-95"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setPinInput((prev) => prev.slice(0, -1))}
                  className="py-2 text-xs font-semibold rounded border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                >
                  ⌫ Del
                </button>
              </div>

              <button
                type="submit"
                disabled={isVerifying || !pinInput.trim()}
                className="w-full mt-3 py-2.5 text-sm font-semibold text-white bg-[#1f2937] hover:bg-[#111827] disabled:opacity-50 flex items-center justify-center gap-2 shadow"
              >
                {isVerifying ? (
                  <>
                    <span className="inline-block animate-spin">⏳</span>
                    <span>Verifying Access…</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-4 h-4 text-emerald-400" />
                    <span>{unlockButtonText || `Unlock ${pageTitle}`}</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-300 bg-[#f1f5f9] flex justify-between text-[11px] text-gray-600">
            <span>© {new Date().getFullYear()} LOTTOCORE Financial Suite</span>
            <span>Security ID: DLB-BAL-SEC</span>
          </div>
        </div>
      </main>
    );
  }

  // When unlocked, render children with security action bar
  return (
    <div className="relative">
      {/* Top Security Bar */}
      <div className="bg-slate-900 text-slate-200 border-b border-slate-700 px-4 py-1.5 flex flex-wrap items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-white">{pageTitle}</span>
          <span className="text-slate-400">|</span>
          <span className="text-emerald-400 font-mono text-[11px]">
            ● Authenticated Officer: {userEmail || "Balance Officer"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowChangePinModal(true)}
            className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 flex items-center gap-1 transition"
          >
            <KeyRound className="w-3 h-3" />
            <span>Change PIN</span>
          </button>
          <button
            type="button"
            onClick={handleLockSession}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 flex items-center gap-1 transition"
            title="Lock this page immediately"
          >
            <Lock className="w-3 h-3 text-red-400" />
            <span>Lock Session</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      {children}

      {/* Change PIN Modal */}
      {showChangePinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-gray-400 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2 text-gray-800">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <h3 className="font-semibold text-sm">Change Balance Officer PIN</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowChangePinModal(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {changePinError && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                {changePinError}
              </div>
            )}
            {changePinSuccess && (
              <div className="rounded border border-green-300 bg-green-50 p-2 text-xs text-green-800 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600" />
                <span>{changePinSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePinSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Current PIN
                </label>
                <input
                  type="password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="Enter current PIN"
                  className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  New PIN (4+ digits)
                </label>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="Enter new PIN"
                  className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Confirm New PIN
                </label>
                <input
                  type="password"
                  value={confirmNewPin}
                  onChange={(e) => setConfirmNewPin(e.target.value)}
                  placeholder="Re-enter new PIN"
                  className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowChangePinModal(false)}
                  className="px-3 py-1.5 rounded border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingPin}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {isUpdatingPin ? "Updating…" : "Update PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
