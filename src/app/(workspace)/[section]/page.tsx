import { notFound, redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { getDashboardData } from '@/server/data';
import { AppError } from '@/server/errors';
export const dynamic = 'force-dynamic';
const sections = ['dashboard','tickets','bugs','standup','team','projects','settings','account'];
export default async function WorkspacePage({params, searchParams}: {params: Promise<{section: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const {section} = await params;
  // "Tasks" were renamed to "tickets". Keep old links working.
  if (section === 'tasks') redirect(`/tickets${queryString(await searchParams)}`);
  if (!sections.includes(section)) notFound();
  let data;
  try { data = await getDashboardData(); }
  catch (error) { if (error instanceof AppError && error.status === 401) redirect('/login'); throw error; }
  if (data.currentUser.role !== 'admin' && ['standup','team','settings'].includes(section)) notFound();
  return <Workspace key={section} initialData={data} />;
}
function queryString(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const entry of [value].flat()) if (entry !== undefined) query.append(key, entry);
  return query.size ? `?${query}` : '';
}
