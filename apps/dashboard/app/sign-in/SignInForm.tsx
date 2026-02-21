"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) {
          setError("Incorrect email or password.");
          setLoading(false);
          return;
        }

        router.push("/app");
        setLoading(false);
      }}
    >
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Email</label>
        <input
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-900">Password</label>
        <input
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

