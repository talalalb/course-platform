import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/current-user';

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('supervisor');
  return <AppShell user={user}>{children}</AppShell>;
}
