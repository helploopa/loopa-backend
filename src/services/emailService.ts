import nodemailer, { Transporter } from 'nodemailer';

// ── Transporter factory ──────────────────────────────────────────────────────
// Configure via environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// When none are set (local dev), nodemailer Ethereal is used automatically and
// the preview URL is printed to the console so you can inspect the email.

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
    if (_transporter) return _transporter;

    if (process.env.SMTP_HOST) {
        _transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    } else {
        // Dev fallback: Ethereal catch-all inbox — no real emails sent
        const testAccount = await nodemailer.createTestAccount();
        _transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass,
            },
        });
        console.log(`📧  Email dev mode — inbox: https://ethereal.email/login  (${testAccount.user} / ${testAccount.pass})`);
    }

    return _transporter;
}

const FROM = process.env.SMTP_FROM ?? '"Loopa 🌿" <hello@loopa.app>';
const APP_URL = process.env.APP_URL ?? 'http://localhost:4000';

// ── Send verification email ───────────────────────────────────────────────────

export async function sendVerificationEmail(
    toEmail: string,
    firstName: string,
    token: string
): Promise<void> {
    const verifyUrl = `${APP_URL}/auth/verify-email?token=${token}`;
    const transporter = await getTransporter();

    const info = await transporter.sendMail({
        from: FROM,
        to: toEmail,
        subject: 'Welcome to Loopa — please verify your email',
        text: [
            `Hi ${firstName},`,
            '',
            'Welcome to Loopa, your neighborhood marketplace!',
            '',
            'Please verify your email address by clicking the link below:',
            verifyUrl,
            '',
            'This link expires in 24 hours.',
            '',
            'If you did not create an account, you can safely ignore this email.',
            '',
            '— The Loopa Team 🌿',
        ].join('\n'),
        html: `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#333">
  <h2 style="color:#4a7c59">Welcome to Loopa 🌿</h2>
  <p>Hi <strong>${firstName}</strong>,</p>
  <p>Thanks for joining Loopa — your neighborhood marketplace for homemade goods!</p>
  <p>Please verify your email address to get started:</p>
  <p style="margin:28px 0">
    <a href="${verifyUrl}"
       style="background:#4a7c59;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
      Verify my email
    </a>
  </p>
  <p style="font-size:13px;color:#888">
    Or copy this link into your browser:<br>
    <a href="${verifyUrl}" style="color:#4a7c59">${verifyUrl}</a>
  </p>
  <p style="font-size:13px;color:#888">This link expires in 24 hours.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#aaa">
    If you didn't create a Loopa account, you can safely ignore this email.
  </p>
</body>
</html>`,
    });

    // In dev (Ethereal), log the preview URL so you can read the email
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
        console.log(`📧  Email preview: ${previewUrl}`);
    }
}
