import { redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { getDashboardData } from '@/server/data';
import { AppError } from '@/server/errors';

/** Loads the workspace once. Moving between pages keeps this layout, so navigation needs no new data request. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  let data;
  try { data = await getDashboardData(); }
  catch (error) { if (error instanceof AppError && error.status === 401) redirect('/login'); throw error; }
  return <Workspace initialData={data}>{children}</Workspace>;
}
