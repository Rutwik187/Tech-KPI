"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LoaderCircle, LogOut, ShieldCheck } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { authClient } from '@/lib/auth-client';
import { Avatar, Panel } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function Account({ data }: { data: DashboardData }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const user = data.currentUser;
  const role = user.role === 'admin' ? 'Admin' : 'Developer';
  async function signOut() {
    setBusy(true);
    try {
      if (data.mode === 'live') {
        const result = await authClient.signOut();
        if (result.error) throw new Error(result.error.message ?? 'Could not sign out.');
      }
      router.push('/login');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out. Please try again.');
      setBusy(false);
    }
  }
  return <div className="account-layout">
    <Panel className="account-profile">
      <Avatar member={user} size="large" />
      <h2>{user.name}</h2>
      <p>{user.email}</p>
      <Badge variant="outline" className="role-tag">{role}</Badge>
      <div className="profile-fact"><span>Hours per week</span><strong>{user.capacity} hours</strong></div>
      <div className="profile-fact"><span>Workspace</span><strong>Urban Gabru</strong></div>
      <Button variant="outline" disabled={busy} onClick={signOut}>{busy ? <LoaderCircle data-icon="inline-start" size={15} className="spin" /> : <LogOut data-icon="inline-start" size={15} />}Sign out</Button>
    </Panel>
    <Panel title="Microsoft work account">
      <div className="account-access">
        <div className="microsoft-account-card"><span className="microsoft-symbol" aria-hidden="true"><i /><i /><i /><i /></span><div><strong>Microsoft sign-in</strong><span>{data.mode === 'demo' ? 'Demo account' : 'Connected to your company account'}</span></div><Badge variant="outline" className="access-tag"><ShieldCheck size={14} />{data.mode === 'demo' ? 'Demo' : 'Connected'}</Badge></div>
        <p>You sign in with your Microsoft work account. Your company manages your password and security.</p>
        <div className="profile-fact"><span>Work email</span><strong>{user.email}</strong></div>
        <div className="profile-fact"><span>Access level</span><strong>{role}</strong></div>
        {user.microsoftObjectId && <div className="microsoft-identity-detail"><span>Microsoft user ID</span><code>{user.microsoftObjectId}</code></div>}
        <Alert className="form-tip"><ShieldCheck size={17} /><AlertDescription><p>For help with your work account, contact your company’s Microsoft administrator.</p></AlertDescription></Alert>
      </div>
    </Panel>
  </div>;
}
