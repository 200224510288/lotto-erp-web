// app/login/page.tsx
"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { useAuth } from "../lib/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const redirect = sp.get("redirect") || "/";

  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(redirect);
  }, [loading, user, router, redirect]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Username and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace(redirect);
    } catch {
      setError("Authentication failed. Please verify your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e5e7eb] text-gray-900">
      <div className="w-full max-w-md border border-gray-400 bg-white shadow">

        {/* ===== Header ===== */}
        <div className="px-6 py-4 border-b border-gray-400 bg-[#f1f5f9]">
          <h1 className="text-xl font-bold tracking-wide text-[#1f2937]">
            LOTTOCORE
          </h1>
          <p className="text-[11px] text-gray-700 mt-0.5">
            Secure Lottery Operations Platform
          </p>
        </div>

        {/* ===== System Notice ===== */}
        <div className="px-6 py-3 border-b border-gray-300 bg-[#fafafa]">
          <p className="text-[11px] text-gray-700 leading-relaxed">
            This system is restricted to authorized personnel only.  
            All access attempts are logged and monitored.
          </p>
        </div>

        {/* ===== Login Form ===== */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="border border-red-400 bg-red-50 px-3 py-2 text-[12px] text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-gray-800 mb-1">
                Username / Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="w-full border border-gray-400 px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-gray-700"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-gray-800 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full border border-gray-400 px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-gray-700"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="w-full py-2 text-sm font-semibold text-white bg-[#1f2937] hover:bg-[#111827] disabled:opacity-60"
            >
              {submitting ? "Authenticating…" : "Sign In"}
            </button>
          </form>
        </div>

        {/* ===== Footer ===== */}
        <div className="px-6 py-3 border-t border-gray-400 bg-[#f1f5f9] flex justify-between text-[11px] text-gray-700">
          <span>© {new Date().getFullYear()} LOTTOCORE</span>
          <span>Created by Aloka Kavitha De Silva</span>
        </div>
      </div>
    </main>
  );
}
