import { LoginForm } from '@/components/login-form';
import './login.css';
export const dynamic = 'force-dynamic';
export default async function LoginPage({searchParams}: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const query = await searchParams;
  const configured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID);
  const oauthError = query.error ? 'We couldn’t sign you in. Only team members can sign in. Ask your admin to add your work email.' : undefined;
  return <LoginForm configured={configured} oauthError={oauthError} />;
}
