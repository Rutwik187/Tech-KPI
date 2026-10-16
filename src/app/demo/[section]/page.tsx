import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { createDemoData } from '@/lib/demo';
export const dynamic = 'force-dynamic';
export default async function DemoPage({params}: {params: Promise<{section: string}>}) {
  const {section} = await params;
  if (!['dashboard','tasks','bugs','standup','team','projects','settings','account'].includes(section)) notFound();
  return <Workspace key={section} initialData={createDemoData()} />;
}
