import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { getClientIdFromSession } from "@/lib/session";
import { listPendingInvitesByClientId, listUsersByClientId } from "@/lib/users";
import { InviteUserForm } from "./InviteUserForm";
import { RevokeInviteButton } from "./RevokeInviteButton";
import { RevokeUserButton } from "./RevokeUserButton";

export default async function UsersPage() {
  const session = await getServerSession(authOptions);
  const clientId = getClientIdFromSession(session);
  const currentUserId = (session?.user as any)?.id as string | undefined;
  if (!clientId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">No client assigned</h1>
      </div>
    );
  }

  const [users, invites] = await Promise.all([
    listUsersByClientId(clientId).catch(() => []),
    listPendingInvitesByClientId(clientId).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Users</h1>
        <p className="mt-1 text-sm text-zinc-600">Manage workspace users and invitations.</p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">Invite user</h2>
        <p className="mb-3 text-xs text-zinc-500">
          We generate a secure invite link now; you can send it manually until email delivery is configured.
        </p>
        <InviteUserForm />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Current users</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Verification</th>
                <th className="px-2 py-2">Joined</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{u.email}</td>
                  <td className="px-2 py-2">
                    {u.email_verified_at ? (
                      <span className="text-emerald-700">Verified</span>
                    ) : (
                      <span className="text-amber-700">Pending</span>
                    )}
                  </td>
                  <td className="px-2 py-2">{new Date(u.membership_created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <RevokeUserButton
                      userId={u.id}
                      email={u.email}
                      disabled={Boolean(currentUserId && currentUserId === u.id)}
                    />
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={4}>
                    No users yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Pending invites</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Invited</th>
                <th className="px-2 py-2">Expires</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t border-zinc-100">
                  <td className="px-2 py-2">{i.email}</td>
                  <td className="px-2 py-2">{new Date(i.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">{new Date(i.expires_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <RevokeInviteButton inviteId={i.id} email={i.email} />
                  </td>
                </tr>
              ))}
              {invites.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-zinc-500" colSpan={4}>
                    No pending invites.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
