export const currentUser = { id: null as string | null };
export async function auth() {
  return { userId: currentUser.id };
}
export async function clerkClient() {
  return {
    users: {
      getUserList: async ({ userId }: { userId?: string[] }) => ({ data: (userId ?? []).map((id) => ({ id, firstName: `Staff ${id}`, lastName: null })) }),
    },
  };
}
