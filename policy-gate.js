// Privacy policy agreement gate.
//
// Shown once per account: on email signup the account is not created until the
// user confirms here, and on sign-in anyone whose profile still has
// policy_accepted = false is held at this modal before continuing.
//
// To revise the policy, edit NC_POLICY_HTML and bump NC_POLICY_VERSION below.
(function () {
  const NC_POLICY_VERSION = '2026-04-17';
  const NC_POLICY_TITLE = 'Privacy Policy';
  const NC_POLICY_SUBTITLE = 'FineAscent LLC. · Effective April 17, 2026';

  const NC_POLICY_HTML = `
    <p class="policy-lede">How FineAscent LLC. collects, uses, shares, and protects information about you
    when you use NobleCart — and our commitment to push back on overbroad legal requests on your behalf.</p>

    <h3>1. Introduction</h3>
    <p>FineAscent LLC. (“we,” “us,” or “our”) operates NobleCart (the “Service”). This Privacy Policy
    explains how we collect, use, disclose, and protect information about you when you use our Service.
    By using the Service, you agree to the practices described in this policy.</p>

    <h3>2. Information We Collect</h3>
    <h4>2.1 Information You Provide Directly</h4>
    <p>When you register or use the Service, we may collect:</p>
    <ul>
      <li>Name</li>
      <li>Email address</li>
      <li>Password (stored in hashed form — never in plaintext)</li>
      <li>Payment information (processed via our third-party payment processor; we do not store full card numbers)</li>
      <li>Any other information you choose to provide</li>
    </ul>
    <h4>2.2 Information Collected Automatically</h4>
    <p>When you use the Service, we may automatically collect:</p>
    <ul>
      <li>IP address and approximate geographic location</li>
      <li>Browser type, operating system, and device information</li>
      <li>Pages visited, features used, and time spent on the Service</li>
      <li>Referring URLs and clickstream data</li>
      <li>Cookies and similar tracking technologies (see Section 6)</li>
    </ul>

    <h3>3. How We Use Your Information</h3>
    <p>We use the information we collect to:</p>
    <ul>
      <li>Create and manage your account</li>
      <li>Process payments and send billing communications</li>
      <li>Provide, operate, and improve the Service</li>
      <li>Send transactional emails (account confirmations, password resets)</li>
      <li>Send service announcements and updates</li>
      <li>Respond to your inquiries and provide customer support</li>
      <li>Detect, investigate, and prevent fraudulent or unauthorized activity</li>
      <li>Comply with applicable legal obligations</li>
    </ul>

    <h3>4. How We Share Your Information</h3>
    <p>We do not sell your personal information. We may share your information with:</p>
    <h4>4.1 Service Providers</h4>
    <p>We engage trusted third-party vendors to support operations, including payment processors, cloud
    infrastructure providers, email delivery services, and analytics providers. These parties are
    contractually obligated to handle your data only as directed by us.</p>
    <h4>4.2 Government and Legal Requests — Our Commitment to You</h4>
    <p>We take your privacy seriously when it comes to government and legal requests. Our approach:</p>
    <ul>
      <li>We will scrutinize every request carefully and require that it be legally valid, specific, and
      narrowly tailored before we consider complying.</li>
      <li>We will legally challenge requests we believe are overbroad, unlawful, or not supported by proper
      legal authority — even if that requires engaging legal counsel at our cost.</li>
      <li>Where legally permitted, we will notify you before complying with a request so you have an
      opportunity to seek your own legal remedy.</li>
      <li>We design our systems to minimize data retention, so that in many cases there is little or nothing
      to produce even if compelled.</li>
      <li>We will never voluntarily provide user data to any government agency without a valid court order,
      subpoena, or equivalent legal process — and even then only the minimum required.</li>
      <li>We publish an annual Transparency Report disclosing the number and type of legal requests we
      receive and how we responded. This report is available at
      https://fineascent.org/noblecart/transparency/.</li>
    </ul>
    <p>Please note: Like all US-based companies, we are legally required to comply with valid, final court
    orders. Our commitment is not to refuse the law — it is to fight hard on your behalf before we ever
    get there.</p>
    <h4>4.3 Business Transfers</h4>
    <p>In the event of a merger, acquisition, or sale of all or a portion of our assets, your information
    may be transferred as part of that transaction. We will notify you via email and/or a prominent notice
    on the Service prior to such transfer.</p>

    <h3>5. Data Retention</h3>
    <p>We follow a minimal retention philosophy. We only keep your data for as long as necessary to provide
    the Service or meet legal obligations. When you delete your account, we will delete or anonymize your
    data within 30 days, except where retention is required by law. We do not retain data speculatively —
    if we do not need it, we do not keep it.</p>

    <h3>6. Cookies and Tracking Technologies</h3>
    <p>We use cookies and similar technologies to:</p>
    <ul>
      <li>Keep you logged in to your account</li>
      <li>Remember your preferences</li>
      <li>Analyze usage patterns and Service performance</li>
    </ul>
    <p>You can control cookie settings through your browser. Disabling certain cookies may affect the
    functionality of the Service. We do not currently respond to “Do Not Track” signals.</p>

    <h3>7. Data Security</h3>
    <p>We implement industry-standard security measures, including encryption in transit (TLS) and at rest,
    to protect your information. However, no method of transmission over the internet or electronic storage
    is 100% secure. We cannot guarantee absolute security.</p>
    <p>If you believe your account has been compromised, please contact us immediately at
    fineascentcreative@gmail.com.</p>

    <h3>8. Children’s Privacy</h3>
    <p>The Service is not directed to children under the age of 13. We do not knowingly collect personal
    information from children under 13. If we become aware that we have inadvertently collected such
    information, we will take steps to delete it promptly.</p>

    <h3>9. Your Rights and Choices</h3>
    <p>You have the following rights regarding your personal information:</p>
    <ul>
      <li><b>Access:</b> Request a copy of the personal information we hold about you</li>
      <li><b>Correction:</b> Request that we correct inaccurate or incomplete information</li>
      <li><b>Deletion:</b> Request that we delete your personal information, subject to legal obligations</li>
      <li><b>Portability:</b> Request your data in a structured, machine-readable format</li>
      <li><b>Opt-out:</b> Unsubscribe from marketing emails at any time via the unsubscribe link</li>
    </ul>
    <p>To exercise these rights, contact us at fineascentcreative@gmail.com. We will respond to verified
    requests within 30 days.</p>

    <h3>10. Third-Party Links</h3>
    <p>The Service may contain links to third-party websites or services. We are not responsible for the
    privacy practices of those third parties. We encourage you to review their privacy policies before
    providing any personal information.</p>

    <h3>11. Changes to This Privacy Policy</h3>
    <p>We may update this Privacy Policy from time to time. We will notify you of material changes by
    posting the revised policy on our website with an updated effective date. Your continued use of the
    Service after any changes constitutes your acceptance of the revised policy.</p>

    <h3>12. Contact Us</h3>
    <p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us:</p>
    <p>FineAscent LLC.<br />
    Email: fineascentcreative@gmail.com<br />
    Website: https://fineascent.org/</p>
  `;

  let openOverlay = null;

  // Resolves true when the user agrees, false if they back out.
  function showPolicyModal(opts) {
    const options = opts || {};
    if (openOverlay) return Promise.resolve(false);

    // The virtual keyboard is fixed to the bottom of the screen and would sit
    // under the modal covering the agree row, so drop focus to dismiss it.
    try { document.activeElement && document.activeElement.blur(); } catch (_) { }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal policy-modal" role="dialog" aria-modal="true" aria-labelledby="policy-modal-title">
          <div class="modal-header" id="policy-modal-title">${NC_POLICY_TITLE}</div>
          <div class="policy-subtitle">${NC_POLICY_SUBTITLE}</div>
          <div class="policy-scroll" tabindex="0">${NC_POLICY_HTML}</div>
          <label class="policy-agree">
            <input type="checkbox" class="policy-agree-box" />
            <span>I have read and agree to the Privacy Policy.</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary policy-cancel">${options.cancelText || 'Cancel'}</button>
            <button type="button" class="btn btn-primary policy-confirm" disabled>${options.confirmText || 'Agree & Continue'}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      openOverlay = overlay;

      const box = overlay.querySelector('.policy-agree-box');
      const confirm = overlay.querySelector('.policy-confirm');
      const cancel = overlay.querySelector('.policy-cancel');
      const scroll = overlay.querySelector('.policy-scroll');

      const close = (agreed) => {
        if (openOverlay !== overlay) return;
        openOverlay = null;
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(agreed);
      };

      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      document.addEventListener('keydown', onKey);

      box.addEventListener('change', () => { confirm.disabled = !box.checked; });
      confirm.addEventListener('click', () => { if (box.checked) close(true); });
      cancel.addEventListener('click', () => close(false));

      // Deliberately no backdrop-click close: agreeing has to be explicit.
      scroll.scrollTop = 0;
    });
  }

  // Holds a signed-in user at the modal until their profile records acceptance.
  // Resolves true if they may proceed.
  async function requireAccepted(sb, userId) {
    if (!sb || !userId) return true;

    let accepted = false;
    try {
      const { data } = await sb
        .from('profiles')
        .select('policy_accepted')
        .eq('id', userId)
        .maybeSingle();
      accepted = data ? data.policy_accepted === true : false;
    } catch (_) {
      // A profile that cannot be read is treated as not yet agreed rather than
      // waved through, so a failed lookup cannot silently skip the agreement.
      accepted = false;
    }
    if (accepted) return true;

    const agreed = await showPolicyModal();
    if (!agreed) return false;

    const record = {
      policy_accepted: true,
      policy_accepted_at: new Date().toISOString(),
      policy_version: NC_POLICY_VERSION,
    };

    try {
      // A plain update, not an upsert: PostgREST builds an upsert as
      // INSERT ... ON CONFLICT DO UPDATE and puts every posted column in the SET
      // list, including id. Migration 0012 revoked table-level UPDATE and never
      // re-granted it on id, so any upsert here fails with 42501. The row itself
      // is guaranteed by the on_auth_user_created trigger and 0012's backfill.
      const { data, error } = await sb
        .from('profiles')
        .update(record)
        .eq('id', userId)
        .select('id');
      if (error) throw error;

      if (!data || data.length === 0) {
        const { error: insertError } = await sb
          .from('profiles')
          .insert(Object.assign({ id: userId }, record));
        if (insertError) throw insertError;
      }
    } catch (e) {
      // Do not let them through on a write failure: they would be prompted again
      // next time anyway, and proceeding would leave no record of consent.
      return false;
    }
    return true;
  }

  window.ncPolicy = {
    VERSION: NC_POLICY_VERSION,
    show: showPolicyModal,
    requireAccepted,
  };
})();
