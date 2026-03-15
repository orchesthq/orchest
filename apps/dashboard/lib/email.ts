import { Resend } from "resend";

class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailConfigError("Email is not configured yet. Set RESEND_API_KEY.");
  }
  return new Resend(apiKey);
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new EmailConfigError("Email sender is not configured yet. Set EMAIL_FROM.");
  }
  return from;
}

export async function sendVerificationEmail(input: {
  toEmail: string;
  verifyUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  const from = getFromAddress();
  await resend.emails.send({
    from,
    to: [input.toEmail],
    subject: "Verify your Orchest account",
    text: [
      "Welcome to Orchest.",
      "",
      "Please verify your email address by opening this link:",
      input.verifyUrl,
      "",
      "If you did not create this account, you can ignore this message.",
    ].join("\n"),
  });
}

export async function sendClientInviteEmail(input: {
  toEmail: string;
  inviteUrl: string;
  invitedByEmail?: string | null;
}): Promise<void> {
  const resend = getResendClient();
  const from = getFromAddress();
  const invitedByLine = input.invitedByEmail ? `Invited by: ${input.invitedByEmail}` : "Invited by your team.";
  await resend.emails.send({
    from,
    to: [input.toEmail],
    subject: "You have been invited to Orchest",
    text: [
      "You have been invited to join an Orchest workspace.",
      invitedByLine,
      "",
      "Accept your invite here:",
      input.inviteUrl,
      "",
      "If you did not expect this invite, you can ignore this message.",
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(input: {
  toEmail: string;
  resetUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  const from = getFromAddress();
  await resend.emails.send({
    from,
    to: [input.toEmail],
    subject: "Reset your Orchest password",
    text: [
      "We received a request to reset your Orchest password.",
      "",
      "Reset your password here:",
      input.resetUrl,
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n"),
  });
}

export { EmailConfigError };
