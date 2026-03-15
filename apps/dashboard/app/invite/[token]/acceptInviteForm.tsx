"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { InlineSpinner } from "@/components/InlineSpinner";
import { authInputCls, authLabelCls, authBtnCls, AuthError } from "@/components/AuthCard";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const res = await fetch("/api/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email, password }),
        });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(j?.error ?? "Could not accept invite");
          setLoading(false);
          return;
        }

        await signIn("credentials", { email, password, redirect: false });
        router.push("/app");
      }}
    >
      <div className="space-y-1.5">
        <label className={authLabelCls}>Email</label>
        <input
          className={authInputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label className={authLabelCls}>Password</label>
        <input
          className={authInputCls}
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p className="text-xs text-zinc-500">
          If you already have an account, enter your existing password. Otherwise choose a new one (min. 8 characters).
        </p>
      </div>

      {error && <AuthError message={error} />}

      <button type="submit" disabled={loading} className={authBtnCls}>
        {loading ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Joining…" : "Accept invite"}
      </button>
    </form>
  );
}
