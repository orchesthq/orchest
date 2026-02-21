export function getClientIdFromSession(session: unknown): string | null {
  const clientId = (session as any)?.user?.clientId;
  return typeof clientId === "string" && clientId.length > 0 ? clientId : null;
}

