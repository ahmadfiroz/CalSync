"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { describeLoginError } from "@/lib/login-error";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = describeLoginError(searchParams.get("error"));

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          CalSync
        </h1>
        <p className="text-sm leading-relaxed text-zinc-400">
          Sign in with Google to open the dashboard. Calendar access is requested
          so CalSync can sync busy times across your connected accounts. Tokens
          and preferences are stored in this instance&apos;s database—not only on
          your device—so use deployments you trust.
        </p>
      </header>

      {error ? (
        <div
          className="whitespace-pre-line rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-center">
        <a
          href="/api/auth/google"
          className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          Continue with Google
        </a>
      </div>

      <p className="text-center text-xs leading-relaxed text-zinc-500">
        CalSync is experimental and under active development. Use at your own
        risk—it may change, break, or mishandle calendar data. Do not rely on it
        for critical or compliance-sensitive scheduling.
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
          <header className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              CalSync
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Sign in with Google to open the dashboard. Calendar access is
              requested so CalSync can sync busy times across your connected
              accounts. Tokens and preferences are stored in this instance&apos;s
              database—not only on your device—so use deployments you trust.
            </p>
          </header>
          <div className="flex justify-center">
            <a
              href="/api/auth/google"
              className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
            >
              Continue with Google
            </a>
          </div>
          <p className="text-center text-xs leading-relaxed text-zinc-500">
            CalSync is experimental and under active development. Use at your
            own risk—it may change, break, or mishandle calendar data. Do not rely
            on it for critical or compliance-sensitive scheduling.
          </p>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
