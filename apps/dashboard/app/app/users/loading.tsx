import { InlineSpinner } from "@/components/InlineSpinner";

export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-zinc-400">
      <InlineSpinner className="h-4 w-4 animate-spin text-violet-500" />
      Loading users…
    </div>
  );
}
