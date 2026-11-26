"use client";

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, LoaderCircle, Mail, Send } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { Panel } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { displayDateTime } from './lib';

type Status = { sender: string | null; week: Partial<Record<'pending' | 'sent' | 'failed' | 'expired', number>>; recent: { id: string; email: string; subject: string; status: string; lastError: string | null; createdAt: string; sentAt: string | null }[] };
const STATUS_WORDS: Record<string, string> = { pending: 'Waiting', sent: 'Sent', failed: 'Failed', expired: 'Too old to send' };

/**
 * For admins: whether the workspace can send email, what went out this week, the latest emails with any error,
 * and a test email to themselves. Emails go through Microsoft from the mailbox in MAIL_FROM.
 */
export function EmailSettings({ data }: { data: DashboardData }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [version, setVersion] = useState(0);
  const live = data.mode === 'live';
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/notifications', { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Email status could not be loaded.');
        setStatus(body); setError('');
      } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); }
    }
    void load();
    return () => controller.abort();
  }, [live, version]);
  async function test() {
    setTesting(true);
    try {
      const response = await fetch('/api/notifications', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'The test email could not be sent.');
      toast.success(`Test email sent to ${body.to}.${body.waitingSent ? ` ${body.waitingSent} waiting ${body.waitingSent === 1 ? 'email' : 'emails'} went out too.` : ''}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The test email could not be sent.', { duration: 10_000 }); }
    finally { setTesting(false); setVersion(v => v + 1); }
  }
  return <Panel title="Email notifications" className="email-settings">
    <div className="email-settings-body">
      <p className="panel-intro">People get an email when a request is raised, forwarded, sent back, assigned, declined, or done, when a plan is sent or confirmed, and when someone writes to them in a request. Each person can turn these emails off on My account.</p>
      {!live ? <p className="form-help">Emails go out from your live workspace.</p>
        : error ? <p className="field-error" role="alert">{error}</p>
        : !status ? <p className="form-help"><LoaderCircle className="spin" size={14} /> Loading…</p>
        : <>
          <div className={clsx('email-sender', status.sender ? 'is-ready' : 'is-off')}>
            {status.sender ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
            <div>{status.sender
              ? <><strong>Emails go out from {status.sender}</strong><span>Through your Microsoft 365 organisation.</span></>
              : <><strong>Email is not set up yet</strong><span>Emails wait for up to three days. Add MAIL_FROM on the server, and grant the Microsoft app the Mail.Send permission.</span></>}</div>
            <Button variant="outline" size="sm" disabled={testing || !status.sender} onClick={() => void test()}>{testing ? <LoaderCircle data-icon="inline-start" className="spin" /> : <Send data-icon="inline-start" />}Send me a test email</Button>
          </div>
          <p className="email-week">This week: <strong>{status.week.sent ?? 0}</strong> sent · <strong>{status.week.pending ?? 0}</strong> waiting · <strong>{status.week.failed ?? 0}</strong> failed</p>
          {status.recent.length > 0 && <ul className="email-list">{status.recent.map(row => <li key={row.id}>
            <Mail aria-hidden="true" />
            <span className="email-list-text"><strong>{row.subject}</strong><span>To {row.email} · {displayDateTime(row.sentAt ?? row.createdAt)}{row.lastError ? ` · ${row.lastError}` : ''}</span></span>
            <Badge variant="outline" className={clsx('email-status', `is-${row.status}`)}>{STATUS_WORDS[row.status] ?? row.status}</Badge>
          </li>)}</ul>}
        </>}
    </div>
  </Panel>;
}
