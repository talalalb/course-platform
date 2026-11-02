import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/current-user';

/** Pages shared by the admin and supervisors. Each page still checks access to the specific student or submission. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole('admin', 'supervisor');
  return <AppShell user={user}>{children}</AppShell>;
}
