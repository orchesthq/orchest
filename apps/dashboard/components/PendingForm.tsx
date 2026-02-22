"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type PendingFormCtx = { pending: boolean };

const PendingFormContext = createContext<PendingFormCtx | null>(null);

export function PendingForm(props: React.FormHTMLAttributes<HTMLFormElement>) {
  const { onSubmit, children, ...rest } = props;
  const [pending, setPending] = useState(false);

  const value = useMemo(() => ({ pending }), [pending]);

  return (
    <PendingFormContext.Provider value={value}>
      <form
        {...rest}
        onSubmit={(e) => {
          setPending(true);
          onSubmit?.(e);
        }}
        aria-busy={pending}
      >
        {children}
      </form>
    </PendingFormContext.Provider>
  );
}

export function usePendingForm(): PendingFormCtx {
  return useContext(PendingFormContext) ?? { pending: false };
}

