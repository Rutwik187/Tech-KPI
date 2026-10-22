import { connection } from 'next/server';
import { Workspace } from '@/components/workspace';
import { createDemoData } from '@/lib/demo';

/** Sample data is dated from today, so it is built per request. It never reaches the database. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <Workspace initialData={createDemoData()}>{children}</Workspace>;
}
