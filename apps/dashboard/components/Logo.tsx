export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="#7c3aed" />
      <circle cx="16" cy="16" r="7" stroke="white" strokeWidth="2.5" fill="none" />
      <circle cx="22.5" cy="9.5" r="2.2" fill="white" />
    </svg>
  );
}

export function Logo({
  className,
  iconClassName = "h-7 w-7",
  showHQ = true,
  textClassName = "text-sm",
}: {
  className?: string;
  iconClassName?: string;
  showHQ?: boolean;
  textClassName?: string;
}) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className={iconClassName} />
      <span className={`font-bold tracking-tight text-white ${textClassName}`}>
        Orchest
        {showHQ && (
          <span className="font-semibold text-violet-400">HQ</span>
        )}
      </span>
    </span>
  );
}
