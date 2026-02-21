import type { Request, Response, NextFunction } from "express";

export class InternalAuthNotConfiguredError extends Error {
  constructor(message = "INTERNAL_SERVICE_SECRET is not configured") {
    super(message);
    this.name = "InternalAuthNotConfiguredError";
  }
}

export function requireInternalServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = process.env.INTERNAL_SERVICE_SECRET;
  if (!expected || expected.trim().length === 0) {
    next(new InternalAuthNotConfiguredError());
    return;
  }

  const provided = req.header("x-internal-secret");
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

