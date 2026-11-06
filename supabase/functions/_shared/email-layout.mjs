// Shared approved NobleCart / FineAscent layout for every application email.
export const SUPPORT_EMAIL = 'support@fineascent.org';
export function escapeEmailHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

// contentHtml must be trusted markup; escape every customer-supplied value first.
export function brandedEmailHtml({ title, preheader, contentHtml }) {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeEmailHtml(title)} · NobleCart</title>
  <style>
    :root { color-scheme:light only; supported-color-schemes:light only; }
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    @media only screen and (min-width:621px) {
      .email-outer { padding:48px 20px !important; }
      .email-inner { padding:0 48px 44px !important; }
      .email-header { padding:0 24px 0 48px !important; }
      .email-brand { padding-top:44px !important; padding-bottom:32px !important; }
      .email-title { font-size:30px !important; line-height:38px !important; }
    }
    @media only screen and (max-width:620px) {
      .email-outer { padding:20px 12px !important; }
      .email-inner { padding:0 24px 32px !important; }
      .email-header { padding:0 20px 0 24px !important; }
      .email-brand { padding-top:32px !important; padding-bottom:28px !important; }
      .email-title { font-size:27px !important; line-height:34px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#e3e3e3;color-scheme:light only;">
  <div style="display:none;font-size:1px;color:#e3e3e3;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#e3e3e3" style="width:100%;background-color:#e3e3e3;">
    <tr><td class="email-outer" align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f2f2f2" style="width:100%;max-width:600px;background-color:#f2f2f2;border-radius:8px;">
        <tr><td class="email-header" style="padding:0 20px 0 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">
            <tr>
              <td class="email-brand" valign="top" style="padding:32px 16px 28px 0;">
                <a href="https://fineascent.org/nobelcart.html" style="display:block;color:#202020;font-family:Arial, Helvetica, sans-serif;font-size:24px;line-height:25px;text-decoration:none;">
                  <img src="https://raw.githubusercontent.com/FineAscent/FineAscent-Website/d81c1579aa11e6986029ead9a7dc590c222abbfe/images/noblecart-wordmark-black.png" width="147" height="25" alt="NobleCart" style="display:block;width:147px;height:25px;border:0;outline:none;color:#202020;font-family:Arial, Helvetica, sans-serif;font-size:24px;line-height:25px;">
                </a>
                <p style="margin:8px 0 0;color:#777777;font-family:Arial, Helvetica, sans-serif;font-size:12px;line-height:18px;">By FineAscent</p>
              </td>
              <td width="44" valign="top" align="right" style="width:44px;padding:24px 0 0;">
                <a href="https://fineascent.org/" aria-label="FineAscent" style="display:block;text-decoration:none;">
                  <img src="https://fineascent.org/images/logo2.png" width="40" height="36" alt="FineAscent mountain" style="display:block;width:40px;height:36px;border:0;outline:none;color:#555555;font-family:Arial, Helvetica, sans-serif;font-size:10px;line-height:14px;">
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td class="email-inner" style="padding:0 24px 32px;">
${contentHtml}
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;margin-top:36px;border-top:1px solid #d8d8d8;">
            <tr><td style="padding-top:22px;color:#777777;font-family:Arial, Helvetica, sans-serif;font-size:12px;line-height:21px;">
              NobleCart by FineAscent<br>
              <a href="mailto:support@fineascent.org" style="color:#666666;text-decoration:underline;">Contact support</a>
              <span style="color:#b0b0b0;">&nbsp; · &nbsp;</span>
              <a href="https://fineascent.org/noblecart/privacy-policy/" style="color:#666666;text-decoration:underline;">Privacy policy</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}
