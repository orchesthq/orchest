import Link from "next/link";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-lg font-bold text-white shadow-lg shadow-violet-600/30">
              O
            </span>
            <span className="text-lg font-bold tracking-tight text-white">Orchest</span>
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl shadow-black/40">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-white">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-zinc-400">{subtitle}</p>}
          </div>
          {children}
        </div>

        {footer && <div className="mt-6 text-center">{footer}</div>}
      </div>
    </div>
  );
}

/** Shared input class for dark auth forms */
export const authInputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50";

/** Shared label class */
export const authLabelCls = "block text-sm font-medium text-zinc-300";

/** Shared primary button class */
export const authBtnCls =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition hover:bg-violet-500 disabled:opacity-50";

/** Error alert */
export function AuthError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2.5 text-sm text-red-400">
      {message}
    </div>
  );
}

/** Success alert */
export function AuthSuccess({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-2.5 text-sm text-emerald-400">
      {message}
    </div>
  );
}
