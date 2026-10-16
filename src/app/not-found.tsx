import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center px-6 py-16">
      <Card className="w-full">
        <CardHeader><CardTitle><h1>Page not found</h1></CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">This page is unavailable for your account.</p></CardContent>
        <CardFooter><Button asChild><Link href="/dashboard">Go to your dashboard<ArrowRight data-icon="inline-end" aria-hidden="true" /></Link></Button></CardFooter>
      </Card>
    </main>
  );
}
