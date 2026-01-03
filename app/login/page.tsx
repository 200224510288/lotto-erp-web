// app/login/page.tsx
import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e5e7eb] text-gray-900">
      <div className="w-full max-w-md border border-gray-400 bg-white shadow">
        <div className="px-6 py-4 border-b border-gray-400 bg-[#f1f5f9]">
          <h1 className="text-xl font-bold tracking-wide text-[#1f2937]">
            LOTTOCORE
          </h1>
          <p className="text-[11px] text-gray-700 mt-0.5">
            Secure Lottery Operations Platform
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="border border-gray-300 bg-[#fafafa] px-3 py-3 text-[12px] text-gray-700">
            Loading…
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-400 bg-[#f1f5f9] flex justify-between text-[11px] text-gray-700">
          <span>© {new Date().getFullYear()} LOTTOCORE</span>
          <span>Created by Aloka Kavitha De Silva</span>
        </div>
      </div>
    </main>
  );
}
