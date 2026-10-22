import { notFound, redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { createDemoData } from '@/lib/demo';
export const dynamic = 'force-dynamic';
export default async function DemoPage({params, searchParams}: {params: Promise<{section: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const {section} = await params;
  if (section === 'tasks') {
    const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => [value].flat().filter((entry): entry is string => entry !== undefined).map(entry => [key, entry])));
    redirect(`/demo/tickets${query.size ? `?${query}` : ''}`);
  }
  if (!['dashboard','tickets','bugs','standup','team','projects','settings','account'].includes(section)) notFound();
  return <Workspace key={section} initialData={createDemoData()} />;
}
