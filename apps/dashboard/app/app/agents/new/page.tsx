import Link from "next/link";
import { NewAgentForm } from "./NewAgentForm";

export default function NewAgentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">New agent</h1>
          <p className="mt-1 text-sm text-zinc-600">Create a new digital employee.</p>
        </div>
        <Link
          href="/app/agents"
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          Back
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <NewAgentForm />
      </div>
    </div>
  );
}

