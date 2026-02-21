import bcrypt from "bcryptjs";
import { query } from "./db";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    "select id, email, password_hash, created_at from users where email = $1 limit 1",
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

