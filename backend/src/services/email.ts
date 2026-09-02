import nodemailer from 'nodemailer'
import { env } from '../env.js'
import { createInvitationProofToken } from './invitationProof.js'

function isSmtpConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPassword)
}

function createTransport() {
  const usesImplicitTls = env.smtpPort === 465
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: usesImplicitTls,
    requireTLS: !usesImplicitTls,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
  })
}

export async function sendInvitationEmail(params: {
  toEmail: string
  invitedByName: string
  projectTitle: string
  role: string
  invitationId: string
}): Promise<void> {
  if (!isSmtpConfigured()) return

  const invitationProof = createInvitationProofToken({
    invitationId: params.invitationId,
    invitedEmail: params.toEmail.toLowerCase(),
  })
  const acceptUrl = `${env.frontendOrigin}/?invitation=${encodeURIComponent(params.invitationId)}&invitationProof=${encodeURIComponent(invitationProof)}`
  const roleLabel = humanizeRole(params.role)

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1f2e; max-width: 600px; margin: 0 auto; padding: 32px 16px; line-height: 1.55;">
  <p style="margin: 0 0 12px; color: #6b7280; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Typstr project invitation</p>
  <h2 style="margin: 0 0 16px; font-size: 28px; line-height: 1.2;">You have been invited to collaborate</h2>
  <p style="color: #374151; margin: 0 0 16px;">
    <strong>${escapeHtml(params.invitedByName)}</strong> invited you to join the project
    <strong>${escapeHtml(params.projectTitle)}</strong> on Typstr with <strong>${escapeHtml(roleLabel)}</strong> access.
  </p>
  <p style="color: #374151; margin: 0 0 24px;">
    To accept the invitation, open the link below and sign in with the Google account you want to use for Typstr.
    If this message was delivered to a non-Gmail address, you can still use the invitation link and complete access with your preferred Google account.
    For security, this invitation link expires after 7 days.
  </p>
  <a href="${acceptUrl}"
     style="display: inline-block; background: #0f766e; color: #fff; text-decoration: none;
            padding: 12px 24px; border-radius: 8px; font-weight: 600;">
    Accept invitation
  </a>
  <p style="color: #6b7280; font-size: 14px; margin: 24px 0 0;">
    Invitation link: <a href="${acceptUrl}" style="color: #0f766e; word-break: break-all;">${acceptUrl}</a>
  </p>
  <p style="color: #9ca3af; font-size: 12px; margin-top: 28px;">
    If you were not expecting this invitation, you can ignore this email.
  </p>
</body>
</html>`

  const text = [
    `${params.invitedByName} invited you to join the project "${params.projectTitle}" on Typstr as ${roleLabel}.`,
    '',
    'To accept the invitation, open the link below and sign in with the Google account you want to use for Typstr.',
    'If this message was delivered to a non-Gmail address, you can still use the invitation link and complete access with your preferred Google account.',
    'For security, this invitation link expires after 7 days.',
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n')

  const transport = createTransport()
  await transport.sendMail({
    from: env.smtpFrom,
    to: params.toEmail,
    subject: `${params.invitedByName} invited you to "${params.projectTitle}" on Typstr`,
    html,
    text,
  })
}

export async function sendEmailVerificationCode(params: {
  toEmail: string
  code: string
  expiresInMinutes: number
}): Promise<void> {
  if (!isSmtpConfigured()) return

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1f2e; max-width: 600px; margin: 0 auto; padding: 32px 16px; line-height: 1.55;">
  <p style="margin: 0 0 12px; color: #6b7280; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Typstr email verification</p>
  <h2 style="margin: 0 0 16px; font-size: 28px; line-height: 1.2;">Verify your email domain</h2>
  <p style="color: #374151; margin: 0 0 16px;">
    Enter this code in Typstr to verify <strong>${escapeHtml(params.toEmail)}</strong>.
  </p>
  <p style="font-size: 30px; letter-spacing: 0.18em; font-weight: 700; margin: 20px 0; color: #0f766e;">
    ${escapeHtml(params.code)}
  </p>
  <p style="color: #6b7280; font-size: 14px; margin: 24px 0 0;">
    This code expires in ${params.expiresInMinutes} minutes. If you did not request it, you can ignore this email.
  </p>
</body>
</html>`

  const text = [
    'Verify your Typstr email domain',
    '',
    `Email: ${params.toEmail}`,
    `Code: ${params.code}`,
    '',
    `This code expires in ${params.expiresInMinutes} minutes.`,
    'If you did not request it, you can ignore this email.',
  ].join('\n')

  const transport = createTransport()
  await transport.sendMail({
    from: env.smtpFrom,
    to: params.toEmail,
    subject: 'Your Typstr verification code',
    html,
    text,
  })
}

export async function sendReviewRequestEmail(params: {
  toEmail: string
  supervisorName?: string | null
  requestedByName: string
  projectTitle: string
  filePath: string
  reviewUrl: string
  message?: string | null
}): Promise<void> {
  if (!isSmtpConfigured()) return

  const greeting = params.supervisorName?.trim() ? `Hello ${escapeHtml(params.supervisorName.trim())},` : 'Hello,'
  const note = params.message?.trim()
    ? `<p style="color: #374151; margin: 0 0 16px;">${escapeHtml(params.message.trim())}</p>`
    : ''
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1f2e; max-width: 600px; margin: 0 auto; padding: 32px 16px; line-height: 1.55;">
  <p style="margin: 0 0 12px; color: #6b7280; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Typstr review request</p>
  <h2 style="margin: 0 0 16px; font-size: 28px; line-height: 1.2;">${greeting}</h2>
  <p style="color: #374151; margin: 0 0 16px;">
    <strong>${escapeHtml(params.requestedByName)}</strong> requested feedback on
    <strong>${escapeHtml(params.projectTitle)}</strong>, file <strong>${escapeHtml(params.filePath)}</strong>.
  </p>
  ${note}
  <a href="${params.reviewUrl}"
     style="display: inline-block; background: #0f766e; color: #fff; text-decoration: none;
            padding: 12px 24px; border-radius: 8px; font-weight: 600;">
    Open review link
  </a>
  <p style="color: #6b7280; font-size: 14px; margin: 24px 0 0;">
    Review link: <a href="${params.reviewUrl}" style="color: #0f766e; word-break: break-all;">${params.reviewUrl}</a>
  </p>
</body>
</html>`

  const text = [
    params.supervisorName?.trim() ? `Hello ${params.supervisorName.trim()},` : 'Hello,',
    '',
    `${params.requestedByName} requested feedback on "${params.projectTitle}", file ${params.filePath}.`,
    params.message?.trim() ? `\nMessage: ${params.message.trim()}\n` : '',
    `Open review link: ${params.reviewUrl}`,
  ].filter(Boolean).join('\n')

  const transport = createTransport()
  await transport.sendMail({
    from: env.smtpFrom,
    to: params.toEmail,
    subject: `${params.requestedByName} requested feedback on "${params.projectTitle}"`,
    html,
    text,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function humanizeRole(role: string): string {
  switch (role) {
    case 'manager':
      return 'Manager'
    case 'editor':
      return 'Editor'
    case 'viewer':
      return 'Viewer'
    default:
      return role
  }
}
