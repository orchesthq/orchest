"use client";

export function DisableButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Disable this agent? This removes the agent and its data.")) {
          e.preventDefault();
        }
      }}
      className="inline-flex items-center rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
    >
      Disable
    </button>
  );
}
