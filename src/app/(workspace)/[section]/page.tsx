import { SECTIONS } from '@/lib/sections';

// The layout renders every section from the URL. Pages only define which sections exist.
export const dynamicParams = false;
export function generateStaticParams() { return SECTIONS.map(section => ({ section })); }
export default function WorkspacePage() { return null; }
