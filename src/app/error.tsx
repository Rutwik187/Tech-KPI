'use client';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function ErrorPage({reset}: {error: Error; reset: () => void}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center px-6 py-16">
      <Card className="w-full">
        <CardHeader className="gap-3">
          <CardDescription>URBAN GABRU / TECH WORKSPACE</CardDescription>
          <CardTitle><h1>We couldn’t load your workspace.</h1></CardTitle>
        </CardHeader>
        <CardContent><p className="text-muted-foreground">Please try again. If this continues, contact your team admin.</p></CardContent>
        <CardFooter><Button onClick={reset}><RefreshCw data-icon="inline-start" aria-hidden="true" />Try again</Button></CardFooter>
      </Card>
    </main>
  );
}
