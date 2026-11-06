import { brandedEmailHtml, escapeEmailHtml } from './email-layout.mjs';

export function verificationEmailHtml(code) {
  const safeCode = escapeEmailHtml(code);
  return brandedEmailHtml({
    title: 'Verify your email',
    preheader: 'Your NobleCart verification code expires in 10 minutes.',
    contentHtml: `          <h1 class="email-title" style="margin:0 0 24px;color:#303030;font-family:Arial, Helvetica, sans-serif;font-size:27px;font-weight:400;letter-spacing:-0.7px;line-height:34px;">Verify your email</h1>
          <p style="margin:0 0 20px;color:#444444;font-family:Arial, Helvetica, sans-serif;font-size:17px;line-height:27px;">Welcome to NobleCart.</p>
<p style="margin:0 0 20px;color:#444444;font-family:Arial, Helvetica, sans-serif;font-size:17px;line-height:27px;">Enter this code in NobleCart to verify your email and continue.</p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;margin:8px 0 24px;">
      <tr><td bgcolor="#ffffff" align="center" style="padding:22px 12px;background-color:#ffffff;border:1px solid #d8d8d8;border-radius:6px;">
        <p style="margin:0 0 10px;color:#777777;font-family:Arial, Helvetica, sans-serif;font-size:11px;line-height:16px;letter-spacing:1.5px;">VERIFICATION CODE</p>
        <p style="margin:0;color:#303030;font-family:Arial, Helvetica, sans-serif;font-size:34px;font-weight:600;line-height:44px;letter-spacing:6px;">${safeCode}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;color:#666666;font-family:Arial, Helvetica, sans-serif;font-size:14px;line-height:23px;">Your code expires in 10 minutes. Do not share it with anyone.</p>


          <p style="margin:0;color:#666666;font-family:Arial, Helvetica, sans-serif;font-size:14px;line-height:23px;">If you did not create a NobleCart account, you can ignore this email.</p>
`,
  });
}
