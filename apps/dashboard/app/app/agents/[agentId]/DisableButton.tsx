"use client";

import { useState } from "react";
import { InlineSpinner } from "@/components/InlineSpinner";

export function DisableButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Disable this agent? This removes the agent and its data.")) {
          e.preventDefault();
          return;
        }
        setPending(true);
      }}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
      {pending ? "Disabling…" : "Disable"}
    </button>
  );
}
