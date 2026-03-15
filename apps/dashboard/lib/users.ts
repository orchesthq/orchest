import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query } from "./db";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
};

export type ClientUserRow = {
  id: string;
  email: string;
  email_verified_at: string | null;
  membership_created_at: string;
};

export type ClientInviteRow = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
};

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    "select id, email, password_hash, email_verified_at, created_at from users where email = $1 limit 1",
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  password: string;
}): Promise<{ id: string; email: string }> {
  const password_hash = await bcrypt.hash(input.password, 12);
  const { rows } = await query<{ id: string; email: string }>(
    "insert into users (email, password_hash) values ($1, $2) returning id, email",
    [input.email.toLowerCase(), password_hash]
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create user");
  return row;
}

export async function verifyPassword(input: {
  password: string;
  passwordHash: string;
}): Promise<boolean> {
  return await bcrypt.compare(input.password, input.passwordHash);
}

export async function getPrimaryClientIdForUser(userId: string): Promise<string | null> {
  const { rows } = await query<{ client_id: string }>(
    [
      "select client_id",
      "from client_memberships",
      "where user_id = $1",
      "order by created_at asc",
      "limit 1",
    ].join("\n"),
    [userId]
  );
  return rows[0]?.client_id ?? null;
}

export async function listUsersByClientId(clientId: string): Promise<ClientUserRow[]> {
  const { rows } = await query<ClientUserRow>(
    [
      "select u.id, u.email, u.email_verified_at, cm.created_at as membership_created_at",
      "from client_memberships cm",
      "join users u on u.id = cm.user_id",
      "where cm.client_id = $1",
      "order by cm.created_at asc",
    ].join("\n"),
    [clientId]
  );
  return rows;
}

export async function listPendingInvitesByClientId(clientId: string): Promise<ClientInviteRow[]> {
  const { rows } = await query<ClientInviteRow>(
    [
      "select id, email, created_at, expires_at",
      "from client_user_invites",
      "where client_id = $1 and accepted_at is null and expires_at > now()",
      "order by created_at desc",
    ].join("\n"),
    [clientId]
  );
  return rows;
}

export async function createEmailVerificationToken(input: {
  userId: string;
  email: string;
  purpose: "signup" | "invite" | "password_reset";
  expiresInHours?: number;
}): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = sha256(token);
  const expiresInHours = Math.max(1, input.expiresInHours ?? 24);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  await query(
    [
      "insert into user_email_verification_tokens (user_id, email, token_hash, purpose, expires_at)",
      "values ($1, $2, $3, $4, $5)",
    ].join("\n"),
    [input.userId, input.email.toLowerCase(), tokenHash, input.purpose, expiresAt]
  );
  return token;
}

export async function verifyEmailToken(token: string): Promise<{ userId: string; email: string } | null> {
  const tokenHash = sha256(token);
  const { rows } = await query<{ user_id: string; email: string }>(
    [
      "update user_email_verification_tokens",
      "set used_at = now()",
      "where token_hash = $1 and used_at is null and expires_at > now()",
      "returning user_id, email",
    ].join("\n"),
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  await query("update users set email_verified_at = now() where id = $1", [row.user_id]);
  return { userId: row.user_id, email: row.email };
}

export async function createClientInvite(input: {
  clientId: string;
  email: string;
  invitedByUserId?: string | null;
  expiresInHours?: number;
}): Promise<string> {
  const email = input.email.toLowerCase();
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    const { rows: existingMemberships } = await query<{ client_id: string }>(
      [
        "select client_id",
        "from client_memberships",
        "where user_id = $1",
        "limit 1",
      ].join("\n"),
      [existingUser.id]
    );
    if (existingMemberships.length > 0) {
      throw new Error("This email already belongs to an active user in another client.");
    }
  }

  const { rows: existingInvites } = await query<{ id: string }>(
    [
      "select id",
      "from client_user_invites",
      "where client_id = $1 and lower(email) = $2 and accepted_at is null and expires_at > now()",
      "limit 1",
    ].join("\n"),
    [input.clientId, email]
  );
  if (existingInvites.length > 0) {
    throw new Error("An active invite already exists for this email.");
  }

  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = sha256(token);
  const expiresInHours = Math.max(1, input.expiresInHours ?? 72);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  await query(
    [
      "insert into client_user_invites (client_id, email, invited_by_user_id, token_hash, expires_at)",
      "values ($1, $2, $3, $4, $5)",
    ].join("\n"),
    [input.clientId, email, input.invitedByUserId ?? null, tokenHash, expiresAt]
  );
  return token;
}

export async function acceptClientInvite(input: {
  token: string;
  email: string;
  password: string;
}): Promise<{ userId: string; clientId: string }> {
  const tokenHash = sha256(input.token);
  const email = input.email.toLowerCase();
  const { rows } = await query<{ id: string; client_id: string; email: string }>(
    [
      "select id, client_id, email",
      "from client_user_invites",
      "where token_hash = $1 and accepted_at is null and expires_at > now()",
      "limit 1",
    ].join("\n"),
    [tokenHash]
  );
  const invite = rows[0];
  if (!invite) throw new Error("Invite is invalid or expired.");
  if (invite.email.toLowerCase() !== email) throw new Error("Invite email does not match.");

  const existing = await getUserByEmail(email);
  let userId = existing?.id ?? "";
  if (existing) {
    const ok = await verifyPassword({ password: input.password, passwordHash: existing.password_hash });
    if (!ok) throw new Error("Existing account password is incorrect.");
    userId = existing.id;
  } else {
    const created = await createUser({ email, password: input.password });
    userId = created.id;
  }

  await query(
    [
      "insert into client_memberships (client_id, user_id, role)",
      "values ($1, $2, 'member')",
      "on conflict (client_id, user_id) do nothing",
    ].join("\n"),
    [invite.client_id, userId]
  );
  await query("update users set email_verified_at = now() where id = $1", [userId]);
  await query(
    [
      "update client_user_invites",
      "set accepted_at = now(), accepted_user_id = $2",
      "where id = $1",
    ].join("\n"),
    [invite.id, userId]
  );
  return { userId, clientId: invite.client_id };
}

export async function revokeClientInvite(input: {
  clientId: string;
  inviteId: string;
}): Promise<void> {
  const { rows } = await query<{ id: string }>(
    [
      "delete from client_user_invites",
      "where client_id = $1 and id = $2 and accepted_at is null",
      "returning id",
    ].join("\n"),
    [input.clientId, input.inviteId]
  );
  if (rows.length === 0) throw new Error("Invite not found.");
}

export async function revokeUserAccessFromClient(input: {
  clientId: string;
  userId: string;
}): Promise<void> {
  const { rows } = await query<{ id: string }>(
    [
      "delete from client_memberships",
      "where client_id = $1 and user_id = $2",
      "returning id",
    ].join("\n"),
    [input.clientId, input.userId]
  );
  if (rows.length === 0) throw new Error("User membership not found.");

  const { rows: remaining } = await query<{ count: string }>(
    [
      "select count(*)::text as count",
      "from client_memberships",
      "where user_id = $1",
    ].join("\n"),
    [input.userId]
  );
  const remainingCount = Number(remaining[0]?.count ?? "0");
  if (remainingCount <= 0) {
    // Cleanly remove user if they no longer belong to any client.
    await query(
      [
        "delete from users",
        "where id = $1",
        "and not exists (",
        "  select 1 from client_memberships where user_id = $1",
        ")",
      ].join("\n"),
      [input.userId]
    );
  }
}

export async function createPasswordResetTokenForEmail(emailRaw: string): Promise<string | null> {
  const email = emailRaw.toLowerCase();
  const user = await getUserByEmail(email);
  if (!user || !user.email_verified_at) return null;
  return await createEmailVerificationToken({
    userId: user.id,
    email: user.email,
    purpose: "password_reset",
    expiresInHours: 2,
  });
}

export async function resetPasswordFromToken(input: {
  token: string;
  newPassword: string;
}): Promise<boolean> {
  const tokenHash = sha256(input.token);
  const { rows } = await query<{ user_id: string; purpose: string }>(
    [
      "update user_email_verification_tokens",
      "set used_at = now()",
      "where token_hash = $1 and purpose = 'password_reset' and used_at is null and expires_at > now()",
      "returning user_id, purpose",
    ].join("\n"),
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return false;

  const password_hash = await bcrypt.hash(input.newPassword, 12);
  await query("update users set password_hash = $2 where id = $1", [row.user_id, password_hash]);
  return true;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

