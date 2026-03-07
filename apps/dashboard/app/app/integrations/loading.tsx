import { InlineSpinner } from "@/components/InlineSpinner";

export default function Loading() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3 text-sm text-zinc-700">
        <InlineSpinner className="h-5 w-5 animate-spin" />
        Loading integrations…
      </div>
    </div>
  );
}
