import { SECTIONS } from '@/lib/sections';

export const dynamicParams = false;
export function generateStaticParams() { return SECTIONS.map(section => ({ section })); }
export default function DemoPage() { return null; }
