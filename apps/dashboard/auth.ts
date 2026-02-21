import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { getUserByEmail, getPrimaryClientIdForUser, verifyPassword } from "./lib/users";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(1),
          })
          .safeParse(credentials);

        if (!parsed.success) return null;

        const user = await getUserByEmail(parsed.data.email);
        if (!user) return null;

        const ok = await verifyPassword({
          password: parsed.data.password,
          passwordHash: user.password_hash,
        });
        if (!ok) return null;

        const clientId = await getPrimaryClientIdForUser(user.id);
        return {
          id: user.id,
          email: user.email,
          clientId,
        } as any; // clientId is added to JWT/session via callbacks below
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = (user as any).id;
        token.clientId = (user as any).clientId ?? null;
      }

      if (!token.clientId && token.userId) {
        token.clientId = await getPrimaryClientIdForUser(String(token.userId));
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.userId;
        (session.user as any).clientId = token.clientId ?? null;
      }
      return session;
    },
  },
};

