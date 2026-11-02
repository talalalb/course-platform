import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/current-user';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('admin');
  return <AppShell user={user}>{children}</AppShell>;
}
