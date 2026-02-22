"use client";

import Link from "next/link";
import { useState } from "react";
import { InlineSpinner } from "./InlineSpinner";

export function LoadingLink(props: {
  href: string;
  className?: string;
  children: React.ReactNode;
  pendingText?: string;
  prefetch?: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Link
      href={props.href}
      prefetch={props.prefetch}
      onClick={() => setPending(true)}
      aria-busy={pending}
      className={[
        props.className ?? "",
        pending ? "pointer-events-none opacity-60" : "",
        "inline-flex items-center gap-2",
      ].join(" ")}
    >
      {pending ? <InlineSpinner className="h-4 w-4 animate-spin" /> : null}
      {pending && props.pendingText ? props.pendingText : props.children}
    </Link>
  );
}

