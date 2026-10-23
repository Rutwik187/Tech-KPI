'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 20 20" data-icon="inline-start" aria-hidden="true">
      <path fill="#f25022" d="M0 0h9v9H0z" />
      <path fill="#7fba00" d="M11 0h9v9h-9z" />
      <path fill="#00a4ef" d="M0 11h9v9h-9z" />
      <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

export function LoginForm({ configured, oauthError }: { configured: boolean; oauthError?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oauthError ?? '');

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.social({ provider: 'microsoft', callbackURL: '/dashboard', errorCallbackURL: '/login' });
      if (result.error) {
        setError('Microsoft sign-in could not start. Please try again or contact your team admin.');
        setBusy(false);
      }
    } catch {
      setError('Microsoft sign-in is unavailable right now. Please retry.');
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <header className="login-header">
        <Link href="/login" className="login-brand" aria-label="Urban Gabru tech workspace">
          <span>urban<span className="login-brand-light">gabru</span><small>TECH WORKSPACE</small></span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="login-grid">
        <section className="login-story" aria-labelledby="login-story-title">
          <div className="login-story-content">
            <p className="login-eyebrow">GOOD WORK STARTS WITH CLARITY</p>
            <h1 id="login-story-title">Less chasing.<br /><span>More shipping.</span></h1>
            <p className="login-story-description">One shared view of what matters.<br />From the morning standup to the final review.</p>
            <div className="login-benefits">
              {['Capture a task or bug in seconds', 'Know what’s pending and who owns it', 'Measure delivery with context'].map(text => (
                <div key={text}><span><Check aria-hidden="true" /></span>{text}</div>
              ))}
            </div>
          </div>
          <p className="login-bottom">Built for the Urban Gabru tech team.</p>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <Card className="login-card">
            <CardHeader className="gap-3">
              <span className="login-account-mark"><ShieldCheck aria-hidden="true" /></span>
              <p className="login-eyebrow">YOUR TEAM. YOUR WORKSPACE.</p>
              <CardTitle><h2 id="login-title">Welcome back.</h2></CardTitle>
              <CardDescription>Use your company Microsoft account to open your workspace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Button size="lg" className="w-full" onClick={signIn} disabled={busy || !configured} aria-busy={busy}>
                {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MicrosoftMark />}
                {busy ? 'Connecting to Microsoft…' : 'Continue with Microsoft'}
                {!busy && <ArrowRight data-icon="inline-end" aria-hidden="true" />}
              </Button>
              {error && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Couldn’t sign in</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!configured && (
                <Alert>
                  <ShieldCheck aria-hidden="true" />
                  <AlertDescription>Microsoft sign-in is being connected. Please contact your team admin.</AlertDescription>
                </Alert>
              )}
              <p className="login-help">Your team admin manages access. Microsoft handles your sign-in.</p>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              <p className="login-demo-copy">Take a look around first.</p>
              <Button variant="outline" size="lg" asChild>
                <Link href="/demo/dashboard">Explore demo<ArrowRight data-icon="inline-end" aria-hidden="true" /></Link>
              </Button>
            </CardFooter>
          </Card>
          <p className="login-footnote">A little structure. A lot more progress.</p>
        </section>
      </div>
    </main>
  );
}
