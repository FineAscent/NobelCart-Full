(function () {
      window.ncCreateBoot = 'start';
      try {
      const form = document.getElementById('create-form');
      const stage = document.getElementById('signup-stage');
      const titleEl = document.getElementById('create-title');
      const nameEl = document.getElementById('create-name');
      const dobEl = document.getElementById('create-dob');
      const phoneEl = document.getElementById('create-phone');
      const emailEl = document.getElementById('create-email');
      const pwEl = document.getElementById('create-password');
      const errEl = document.getElementById('create-error');
      const dobHint = document.getElementById('dob-hint');
      const submitBtn = document.getElementById('create-submit');
      const pillLeft = document.getElementById('pill-left');
      const pillRight = document.getElementById('pill-right');

      const steps = Array.from(document.querySelectorAll('#step-viewport .auth-field[data-step]'))
        .sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
      const inputs = [nameEl, dobEl, phoneEl, emailEl, pwEl];
      let activeStep = 0;
      let animating = false;

      let signupEmailPrefill = '';
      try {
        const PREFILL_MS = 20 * 1000;
        const params = new URLSearchParams(window.location.search);
        const qEmail = String(params.get('email') || '').trim();
        const qAt = Number(params.get('e_at') || 0);
        if (qEmail && qAt && (Date.now() - qAt) <= PREFILL_MS) {
          signupEmailPrefill = qEmail.toLowerCase();
        } else {
          const raw =
            sessionStorage.getItem('nc_signup_email') ||
            localStorage.getItem('nc_signup_email');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const email = String(parsed.email || '').trim();
              const at = Number(parsed.at) || 0;
              if (email && at && (Date.now() - at) <= PREFILL_MS) {
                signupEmailPrefill = email.toLowerCase();
              }
            } catch (_) {}
          }
        }
        try { sessionStorage.removeItem('nc_signup_email'); } catch (_) {}
        try { localStorage.removeItem('nc_signup_email'); } catch (_) {}
        // Drop prefill params from the address bar so a later refresh won't reuse them.
        if (params.has('email') || params.has('e_at')) {
          params.delete('email');
          params.delete('e_at');
          const next = window.location.pathname.split('/').pop() +
            (params.toString() ? '?' + params.toString() : '');
          try { history.replaceState(null, '', next); } catch (_) {}
        }
      } catch (_) {}

      function applySignupEmailPrefill() {
        if (!signupEmailPrefill || !emailEl) return;
        emailEl.value = signupEmailPrefill;
        try { emailEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      }

      function daysInMonth(month, year) {
        if (!month || month < 1 || month > 12) return 31;
        if (!year || year < 1) return 31;
        return new Date(year, month, 0).getDate();
      }

      function formatDobInput(raw) {
        let d = String(raw || '').replace(/\D/g, '').slice(0, 8);
        if (d.length === 1 && d[0] >= '2' && d[0] <= '9') d = '0' + d[0];
        if (d.length >= 2) {
          let m = parseInt(d.slice(0, 2), 10);
          if (m > 12) {
            d = '0' + d[0] + d.slice(1);
            m = parseInt(d.slice(0, 2), 10);
          }
          if (d.slice(0, 2) === '00') m = 1;
          if (m < 1) m = 1;
          if (m > 12) m = 12;
          d = String(m).padStart(2, '0') + d.slice(2);
        }
        if (d.length === 3 && d[2] >= '4' && d[2] <= '9') {
          d = d.slice(0, 2) + '0' + d[2];
        }
        if (d.length >= 4) {
          const month = parseInt(d.slice(0, 2), 10);
          const yearPart = d.slice(4);
          const year = yearPart.length === 4 ? parseInt(yearPart, 10) : 0;
          let day = parseInt(d.slice(2, 4), 10);
          const maxD = daysInMonth(month, year || 2000);
          if (d.slice(2, 4) === '00') day = 1;
          if (day > maxD) day = maxD;
          if (day < 1) day = 1;
          d = d.slice(0, 2) + String(day).padStart(2, '0') + d.slice(4);
        }
        if (d.length <= 2) return d;
        if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
        return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
      }

      function dobToIso(display) {
        const m = String(display || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m) return null;
        const month = parseInt(m[1], 10);
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        if (month < 1 || month > 12) return null;
        const maxD = daysInMonth(month, year);
        if (day < 1 || day > maxD) return null;
        const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const dt = new Date(iso + 'T00:00:00Z');
        if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
        return iso;
      }

      function ageFromIso(iso) {
        const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
        const now = new Date();
        let age = now.getFullYear() - y;
        const hadBirthday =
          now.getMonth() + 1 > m ||
          (now.getMonth() + 1 === m && now.getDate() >= d);
        if (!hadBirthday) age -= 1;
        return age;
      }

      /** Returns an error message if DOB is future or age is outside 13–129. */
      function dobAgeError(iso) {
        if (!iso) return 'Enter date of birth as MM/DD/YYYY.';
        const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
        const birth = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (birth > today) return 'Date of birth can’t be in the future.';
        const age = ageFromIso(iso);
        if (age < 13) return 'You must be at least 13 years old.';
        if (age >= 130) return 'Check that date of birth.';
        return null;
      }

      function daysUntilBirthday(iso) {
        const [, m, d] = iso.split('-').map((n) => parseInt(n, 10));
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let next = new Date(now.getFullYear(), m - 1, d);
        if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
        return Math.round((next - today) / 86400000);
      }

      function updateDobHint(display) {
        if (!dobHint) return;
        dobHint.classList.remove('dob-hint--age', 'dob-hint--bday');
        const digits = String(display || '').replace(/\D/g, '');
        // Quiet while typing — only react once the date is complete.
        if (digits.length < 8) { dobHint.textContent = ''; return; }
        const iso = dobToIso(display);
        if (!iso) { dobHint.textContent = 'Check that date'; return; }
        const ageErr = dobAgeError(iso);
        if (ageErr) { dobHint.textContent = ageErr; return; }
        const age = ageFromIso(iso);
        const until = daysUntilBirthday(iso);
        if (until === 0) {
          dobHint.classList.add('dob-hint--bday');
          dobHint.textContent = 'Happy Birthday — you are ' + age + ' today.';
          return;
        }
        if (until > 0 && until <= 13) {
          dobHint.classList.add('dob-hint--bday');
          dobHint.textContent =
            until === 1
              ? 'You are ' + age + ' — birthday tomorrow.'
              : 'You are ' + age + ' — birthday in ' + until + ' days.';
          return;
        }
        dobHint.classList.add('dob-hint--age');
        dobHint.textContent = 'You are ' + age + ' years old.';
      }

      const dobSegMonth = document.getElementById('dob-seg-month');
      const dobSegDay = document.getElementById('dob-seg-day');
      const dobSegYear = document.getElementById('dob-seg-year');
      const dobSegMonthVal = document.getElementById('dob-seg-month-val');
      const dobSegDayVal = document.getElementById('dob-seg-day-val');
      const dobSegYearVal = document.getElementById('dob-seg-year-val');
      const dobPickerHint = document.getElementById('dob-picker-hint');
      let dobActiveSeg = 'month';
      let dobParts = { m: '', day: '', y: '' };

      function normalizeDobParts(parts) {
        let m = String(parts.m || '').replace(/\D/g, '').slice(0, 2);
        let day = String(parts.day || '').replace(/\D/g, '').slice(0, 2);
        let y = String(parts.y || '').replace(/\D/g, '').slice(0, 4);
        // Soft-correct complete month/day; allow 1-digit while typing.
        if (m.length === 2) {
          let mi = parseInt(m, 10);
          if (mi < 1) mi = 1;
          if (mi > 12) mi = 12;
          m = String(mi).padStart(2, '0');
        }
        if (day.length === 2 && m.length === 2) {
          const maxD = daysInMonth(parseInt(m, 10), y.length === 4 ? parseInt(y, 10) : 2000);
          let di = parseInt(day, 10);
          if (di < 1) di = 1;
          if (di > maxD) di = maxD;
          day = String(di).padStart(2, '0');
        }
        return { m, day, y };
      }

      function dobDisplayFromParts(parts) {
        const p = normalizeDobParts(parts);
        if (p.m.length === 2 && p.day.length === 2 && p.y) return p.m + '/' + p.day + '/' + p.y;
        if (p.m.length === 2 && p.day.length === 2) return p.m + '/' + p.day;
        if (p.m) return p.m + (p.day ? '/' + p.day : '');
        return '';
      }

      function getDobDisplay() {
        return dobDisplayFromParts(dobParts);
      }

      function segBufferValue(seg, parts) {
        if (seg === 'month') return parts.m || '';
        if (seg === 'day') return parts.day || '';
        return parts.y || '';
      }

      function segMaxLen(seg) {
        return seg === 'year' ? 4 : 2;
      }

      function updateDobHintText() {
        if (!dobPickerHint) return;
        if (dobActiveSeg === 'month') dobPickerHint.textContent = 'Type the month (MM)';
        else if (dobActiveSeg === 'day') dobPickerHint.textContent = 'Type the day (DD)';
        else dobPickerHint.textContent = 'Type the year (YYYY), then Done';
        dobPickerHint.hidden = false;
      }

      function updateDobSegments(parts) {
        const m = parts.m || '';
        const day = parts.day || '';
        const y = parts.y || '';
        if (dobSegMonthVal) dobSegMonthVal.textContent = m || 'MM';
        if (dobSegDayVal) dobSegDayVal.textContent = day || 'DD';
        if (dobSegYearVal) dobSegYearVal.textContent = y || 'YYYY';
        dobSegMonth?.classList.toggle('is-filled', m.length === 2);
        dobSegDay?.classList.toggle('is-filled', day.length === 2);
        dobSegYear?.classList.toggle('is-filled', y.length === 4);
        dobSegMonth?.classList.toggle('is-active', dobActiveSeg === 'month');
        dobSegDay?.classList.toggle('is-active', dobActiveSeg === 'day');
        dobSegYear?.classList.toggle('is-active', dobActiveSeg === 'year');
      }

      function commitDobParts(next, opts) {
        // While typing a segment, don't pad/clamp until the segment is complete
        // (except when flushing / advancing).
        if (opts?.raw) {
          dobParts = {
            m: String(next.m || '').replace(/\D/g, '').slice(0, 2),
            day: String(next.day || '').replace(/\D/g, '').slice(0, 2),
            y: String(next.y || '').replace(/\D/g, '').slice(0, 4),
          };
        } else {
          dobParts = normalizeDobParts(next || dobParts);
        }
        if (dobEl) {
          if (opts?.segBuffer) {
            const buf = segBufferValue(dobActiveSeg, dobParts);
            if (dobEl.value !== buf) dobEl.value = buf;
          } else {
            const full = dobDisplayFromParts(dobParts);
            if (dobEl.value !== full) dobEl.value = full;
          }
        }
        updateDobSegments(dobParts);
        updateDobHint(dobDisplayFromParts(dobParts));
        if (!opts?.skipLayout) scheduleLayout();
      }

      function flushDobSegBuffer() {
        dobParts = normalizeDobParts(dobParts);
        if (dobEl) dobEl.value = dobDisplayFromParts(dobParts);
        updateDobSegments(dobParts);
        updateDobHint(dobDisplayFromParts(dobParts));
      }

      function focusDobSegment(seg) {
        if (!dobEl) return;
        document.body.classList.add('keyboard-visible', 'focus-dob');
        dobEl.value = segBufferValue(seg, dobParts);
        setTimeout(() => {
          try { dobEl.focus({ preventScroll: true }); } catch (_) {
            try { dobEl.focus(); } catch (__) {}
          }
          try {
            const len = dobEl.value.length;
            dobEl.setSelectionRange(len, len);
          } catch (_) {}
        }, 30);
      }

      function setDobSegment(seg, opts) {
        if (seg !== dobActiveSeg) flushDobSegBuffer();
        dobActiveSeg = seg;
        updateDobSegments(dobParts);
        updateDobHintText();
        focusDobSegment(seg);
        if (!opts?.quiet) scheduleLayout();
      }

      function preferDobSegment() {
        if (dobParts.m.length !== 2) return 'month';
        if (dobParts.day.length !== 2) return 'day';
        return 'year';
      }

      function activateDobTouch() {
        setDobSegment(preferDobSegment());
      }

      function maybeAdvanceDobSeg() {
        if (dobActiveSeg === 'month' && dobParts.m.length === 2) {
          dobParts = normalizeDobParts(dobParts);
          setDobSegment('day');
          return;
        }
        if (dobActiveSeg === 'day' && dobParts.day.length === 2) {
          dobParts = normalizeDobParts(dobParts);
          setDobSegment('year');
        }
      }

      [dobSegMonth, dobSegDay, dobSegYear].forEach((btn) => {
        btn?.addEventListener('click', () => {
          const seg = btn.dataset.seg;
          if (!seg) return;
          setDobSegment(seg);
        });
      });

      if (dobEl) {
        dobEl.addEventListener('input', () => {
          const digits = String(dobEl.value || '').replace(/\D/g, '').slice(0, segMaxLen(dobActiveSeg));
          const next = { ...dobParts };
          if (dobActiveSeg === 'month') next.m = digits;
          else if (dobActiveSeg === 'day') next.day = digits;
          else next.y = digits;
          commitDobParts(next, { raw: true, segBuffer: true, skipLayout: true });
          maybeAdvanceDobSeg();
        });
      }

      commitDobParts(dobParts, { skipLayout: true });
      updateDobHintText();


      function formatUsPhone(raw) {
        let d = String(raw || '').replace(/\D/g, '');
        // Drop US country code if user typed +1 / 1…
        if (d.length === 11 && d[0] === '1') d = d.slice(1);
        d = d.slice(0, 10);
        if (d.length === 0) return '';
        if (d.length < 4) return '(' + d;
        if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
        return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      }

      const phoneHint = document.getElementById('phone-hint');
      const PHONE_REPEAT_JOKES = [
        'Easy there — that digit is getting a workout.',
        'Four in a row? Bold number energy.',
        'We believe you… but maybe mix it up a little?',
      ];

      function updatePhoneJokeHint(raw) {
        if (!phoneHint) return;
        const d = String(raw || '').replace(/\D/g, '');
        if (!/(.)\1{3,}/.test(d)) {
          phoneHint.textContent = '';
          return;
        }
        const digit = (d.match(/(.)\1{3,}/) || [])[1] || '';
        const joke = PHONE_REPEAT_JOKES[digit ? (parseInt(digit, 10) % PHONE_REPEAT_JOKES.length) : 0];
        phoneHint.textContent = joke;
      }

      function bindUsPhoneInput(el) {
        if (!el) return;
        el.addEventListener('input', () => {
          const formatted = formatUsPhone(el.value);
          if (el.value !== formatted) {
            el.value = formatted;
            try { el.setSelectionRange(formatted.length, formatted.length); } catch (_) {}
          }
          if (el === phoneEl) updatePhoneJokeHint(formatted);
        });
      }

      bindUsPhoneInput(phoneEl);

      const emailHints = document.getElementById('email-domain-hints');

      function updateEmailDomainHints() {
        if (!emailEl || !emailHints) return;
        const val = String(emailEl.value || '');
        const at = val.indexOf('@');
        if (at < 0) {
          emailHints.hidden = true;
          return;
        }
        const local = val.slice(0, at);
        if (!local) {
          emailHints.hidden = true;
          return;
        }
        const typed = val.slice(at + 1).toLowerCase();
        let visible = 0;
        emailHints.querySelectorAll('.email-domain-chip').forEach((chip) => {
          const domain = chip.dataset.domain || '';
          const match = !typed || domain.startsWith(typed);
          const exact = typed === domain;
          chip.hidden = !match || exact;
          if (!chip.hidden) visible += 1;
        });
        emailHints.hidden = visible === 0;
      }

      if (emailEl && emailHints) {
        emailEl.addEventListener('input', updateEmailDomainHints);
        emailEl.addEventListener('focus', updateEmailDomainHints);
        emailHints.addEventListener('pointerdown', (e) => {
          const chip = e.target.closest('.email-domain-chip');
          if (!chip || chip.hidden) return;
          e.preventDefault();
          const at = String(emailEl.value || '').indexOf('@');
          const local = at >= 0 ? emailEl.value.slice(0, at) : emailEl.value.trim();
          if (!local) return;
          emailEl.value = local + '@' + chip.dataset.domain;
          emailHints.hidden = true;
          try { emailEl.focus({ preventScroll: true }); } catch (_) {
            try { emailEl.focus(); } catch (__) {}
          }
          emailEl.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }

      function clearStepHints() {
        document.querySelectorAll('.step-hint').forEach((el) => {
          el.hidden = true;
          el.textContent = '';
        });
      }

      function showStepHint(stepIndex, msg) {
        clearStepHints();
        const field = steps[stepIndex];
        if (!field) return;
        const hint = field.querySelector('.step-hint');
        if (!hint) return;
        hint.textContent = msg || '';
        hint.hidden = !msg;
        field.classList.remove('is-shake');
        void field.offsetWidth;
        field.classList.add('is-shake');
        setTimeout(() => field.classList.remove('is-shake'), 450);
      }

      const pillAnimGen = new WeakMap();

      function fillPillContent(btn, stepIndex) {
        const field = steps[stepIndex];
        const label = field?.dataset.stepLabel || ('Step ' + (stepIndex + 1));
        btn.dataset.stepIndex = String(stepIndex);
        btn.setAttribute('aria-label', label + '. Tap to edit.');
        btn.innerHTML =
          '<span class="pill-copy">' +
            '<span class="pill-label">' + label + '</span>' +
            '<span class="pill-hint">Tap to edit</span>' +
          '</span>' +
          '<span class="pill-check" aria-hidden="true">✓</span>';
      }

      function clearPillContent(btn) {
        btn.dataset.stepIndex = '';
        btn.removeAttribute('aria-label');
        btn.textContent = '';
      }

      function renderPill(btn, stepIndex) {
        if (!btn) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const nextKey = stepIndex == null || stepIndex < 0 ? '' : String(stepIndex);
        const prevKey = btn.dataset.stepIndex || '';
        const isShown = !btn.hidden && btn.classList.contains('is-visible');
        const gen = (pillAnimGen.get(btn) || 0) + 1;
        pillAnimGen.set(btn, gen);

        function fadeIn() {
          if (pillAnimGen.get(btn) !== gen) return;
          btn.hidden = false;
          fillPillContent(btn, stepIndex);
          if (reduceMotion) {
            btn.classList.add('is-visible');
            return;
          }
          btn.classList.remove('is-visible');
          void btn.offsetWidth;
          requestAnimationFrame(() => {
            if (pillAnimGen.get(btn) !== gen) return;
            btn.classList.add('is-visible');
          });
        }

        function fadeOut(then) {
          if (reduceMotion || !isShown) {
            btn.classList.remove('is-visible');
            btn.hidden = true;
            clearPillContent(btn);
            then?.();
            return;
          }
          btn.classList.remove('is-visible');
          let done = false;
          const finish = () => {
            if (done || pillAnimGen.get(btn) !== gen) return;
            done = true;
            btn.removeEventListener('transitionend', onEnd);
            btn.hidden = true;
            clearPillContent(btn);
            then?.();
          };
          const onEnd = (e) => {
            if (e.target !== btn) return;
            if (e.propertyName !== 'opacity') return;
            finish();
          };
          btn.addEventListener('transitionend', onEnd);
          setTimeout(finish, 320);
        }

        if (nextKey === '') {
          if (!isShown && btn.hidden) {
            clearPillContent(btn);
            return;
          }
          fadeOut();
          return;
        }

        if (isShown && prevKey === nextKey) {
          fillPillContent(btn, stepIndex);
          return;
        }

        if (!isShown || prevKey === '') {
          fadeIn();
          return;
        }

        // Content change: fade out, swap, fade in.
        fadeOut(() => {
          if (pillAnimGen.get(btn) !== gen) return;
          fadeIn();
        });
      }

      
      function updateDots() {
        /* Step dots removed — progress is shown via side pills. */
      }

      function updatePills() {
        renderPill(pillRight, activeStep >= 1 ? activeStep - 1 : null);
        renderPill(pillLeft, activeStep >= 2 ? activeStep - 2 : null);
      }

      function isVkShown() {
        const vk = document.getElementById('vk-auth');
        if (!vk) return false;
        if (vk.style.display === 'none') return false;
        const cs = window.getComputedStyle(vk);
        return cs.display !== 'none' && vk.getBoundingClientRect().height > 0;
      }

      function layoutSignupView() {
        const center = document.getElementById('signup-center');
        if (center) center.style.transform = '';
        center?.style.removeProperty('--pill-band');

        const kbOpen = document.body.classList.contains('keyboard-visible') && isVkShown();
        if (kbOpen) {
          const top = Math.round(document.getElementById('vk-auth').getBoundingClientRect().top);
          document.body.style.setProperty('--signup-safe-h', Math.max(top, 120) + 'px');
        } else {
          document.body.style.removeProperty('--signup-safe-h');
        }
      }

      function scheduleLayout() {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          layoutSignupView();
          requestAnimationFrame(layoutSignupView);
        }));
      }

      function welcomeName() {
        const raw = (nameEl?.value || '').trim().replace(/\s+/g, ' ');
        if (!raw) return '';
        const first = raw.split(' ')[0];
        return first.charAt(0).toUpperCase() + first.slice(1);
      }

      function titleForStep(stepIndex) {
        if (stepIndex > 0) {
          const name = welcomeName();
          if (name) return 'Welcome ' + name;
        }
        return 'Create account';
      }

      let titleAnimTimer = null;
      function updateTitle(stepIndex) {
        if (!titleEl) return;
        const next = titleForStep(stepIndex);
        if (titleEl.textContent === next) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
          titleEl.textContent = next;
          titleEl.classList.remove('is-title-out', 'is-title-in');
          return;
        }
        if (titleAnimTimer) clearTimeout(titleAnimTimer);
        titleEl.classList.remove('is-title-in');
        titleEl.classList.add('is-title-out');
        titleAnimTimer = setTimeout(() => {
          titleEl.textContent = next;
          titleEl.classList.remove('is-title-out');
          titleEl.classList.add('is-title-in');
          void titleEl.offsetWidth;
          requestAnimationFrame(() => {
            titleEl.classList.remove('is-title-in');
          });
          titleAnimTimer = null;
        }, 200);
      }

      function setActiveStepAttr(i) {
        document.body.dataset.activeStep = String(i);
        if (stage) stage.dataset.activeStep = String(i);
        if (submitBtn) submitBtn.hidden = i !== 4;
        updateDots();
        updateTitle(i);
        scheduleLayout();
      }

      function focusActiveInput() {
        if (activeStep === 1) {
          activateDobTouch();
          return;
        }
        if (activeStep === 3) applySignupEmailPrefill();
        const el = inputs[activeStep];
        if (!el) return;
        setTimeout(() => {
          try { el.focus({ preventScroll: true }); } catch (_) {
            try { el.focus(); } catch (__) {}
          }
        }, 30);
      }

      function goToStep(i, opts) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const next = Math.max(0, Math.min(steps.length - 1, i));
        if (next === activeStep && !opts?.force) {
          updatePills();
          updateDots();
          layoutSignupView();
          focusActiveInput();
          return;
        }
        if (animating) return;
        const from = activeStep;
        if (from === 1) flushDobSegBuffer();
        const forward = next > from;
        const fromEl = steps[from];
        const toEl = steps[next];
        clearStepHints();
        if (errEl) errEl.style.display = 'none';

        if (reduceMotion) {
          if (activeStep === 1) flushDobSegBuffer();
          steps.forEach((s) => s.classList.remove('is-active', 'is-exit-left', 'is-exit-right', 'is-enter-from-left', 'is-enter-from-right'));
          toEl.classList.add('is-active');
          activeStep = next;
          setActiveStepAttr(activeStep);
          updatePills();
          updateDots();
          focusActiveInput();
          return;
        }

        animating = true;
        updateTitle(next);
        fromEl.classList.remove('is-active');
        fromEl.classList.add(forward ? 'is-exit-left' : 'is-exit-right');
        toEl.classList.add(forward ? 'is-enter-from-right' : 'is-enter-from-left');
        void toEl.offsetWidth;
        toEl.classList.add('is-active');
        toEl.classList.remove('is-enter-from-right', 'is-enter-from-left');

        setTimeout(() => {
          fromEl.classList.remove('is-exit-left', 'is-exit-right');
          activeStep = next;
          setActiveStepAttr(activeStep);
          updatePills();
          animating = false;
          focusActiveInput();
        }, 240);
      }

      function validateStep(i) {
        if (i === 0) {
          if (!(nameEl.value || '').trim()) return 'Please enter your name.';
          return null;
        }
        if (i === 1) {
          flushDobSegBuffer();
          const iso = dobToIso(getDobDisplay());
          if (!iso) return 'Enter date of birth as MM/DD/YYYY.';
          const ageErr = dobAgeError(iso);
          if (ageErr) return ageErr;
          return null;
        }
        if (i === 2) {
          const phone = (phoneEl.value || '').replace(/\D/g, '');
          if (phone.length < 10) return 'Enter a valid US phone number.';
          return null;
        }
        if (i === 3) {
          const email = (emailEl.value || '').trim();
          if (!email || !email.includes('@') || !email.includes('.')) return 'Enter a valid email.';
          return null;
        }
        if (i === 4) {
          const pw = (pwEl.value || '').trim();
          if (pw.length < 7) return 'Use at least 7 letters or numbers.';
          if (!/^[a-zA-Z0-9]+$/.test(pw)) return 'Letters and numbers only — no spaces or symbols.';
          return null;
        }
        return null;
      }

      function goNext() {
        const err = validateStep(activeStep);
        if (err) {
          showStepHint(activeStep, err);
          focusActiveInput();
          return false;
        }
        // After “Change my email”, Done on email re-sends OTP to the new address.
        if (activeStep === 3 && (pendingId || pendingUserId)) {
          (async () => {
            try {
              const data = await invokeAuth('auth-signup', {
                full_name: (nameEl?.value || '').trim(),
                date_of_birth: dobToIso(getDobDisplay()),
                phone: (phoneEl?.value || '').trim(),
                email: (emailEl?.value || '').trim(),
                password: (pwEl?.value || '').trim() || pendingPassword,
              });
              pendingId = data.pending_id || pendingId;
              pendingEmail = data.email || (emailEl?.value || '').trim();
              openOtp(data.phone || (phoneEl?.value || '').trim(), pendingEmail);
            } catch (e) {
              showStepHint(3, e.message || 'Could not update email.');
              showError(e.message || 'Could not update email.');
              focusActiveInput();
            }
          })();
          return true;
        }
        if (activeStep >= steps.length - 1) {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          return true;
        }
        goToStep(activeStep + 1);
        return true;
      }

      function onPillClick(e) {
        const btn = e.currentTarget;
        const idx = Number(btn.dataset.stepIndex);
        if (Number.isNaN(idx)) return;
        goToStep(idx);
      }

      pillLeft?.addEventListener('click', onPillClick);
      pillRight?.addEventListener('click', onPillClick);

      inputs.forEach((el, i) => {
        el?.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (i !== activeStep) goToStep(i);
          goNext();
        });
      });

      // VK Done / Create on create-account is owned by the carousel.
      window.ncSignupSteps = {
        handleVkDone(current) {
          if (!document.body.classList.contains('create-account')) return false;
          const idx = inputs.indexOf(current);
          if (idx < 0) return false;
          if (idx === 1) flushDobSegBuffer();
          if (idx !== activeStep) goToStep(idx, { force: true });
          goNext();
          return true;
        },
        getActiveInput() {
          return inputs[activeStep] || null;
        },
        isLastStep() {
          return activeStep >= steps.length - 1;
        },
        goToStep(i) {
          goToStep(i, { force: true });
        },
        layout() {
          layoutSignupView();
        },
      };
      window.__signupSteps = window.ncSignupSteps;

      setActiveStepAttr(0);
      updatePills();
      layoutSignupView();
      window.addEventListener('resize', scheduleLayout);
      window.addEventListener('vk:visibility', () => {
        scheduleLayout();
        setTimeout(layoutSignupView, 80);
      });
      new MutationObserver(scheduleLayout).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });

      const otpOverlay = document.getElementById('otp-overlay');
      const otpHint = document.getElementById('otp-hint');
      const otpInput = document.getElementById('otp-input');
      const otpVerifyBtn = document.getElementById('otp-verify-btn');
      const otpResendBtn = document.getElementById('otp-resend-btn');
      const otpWrongBtn = document.getElementById('otp-wrong-btn');
      const otpError = document.getElementById('otp-error');

      if (otpInput) {
        otpInput.addEventListener('input', () => {
          const digits = String(otpInput.value || '').replace(/\D/g, '').slice(0, 6);
          if (otpInput.value !== digits) otpInput.value = digits;
        });
        otpInput.addEventListener('focus', () => {
          document.body.classList.add('keyboard-visible');
          scheduleLayout();
        });
      }

      if (otpInput && otpVerifyBtn) {
        otpInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          otpVerifyBtn.click();
        });
      }

      let pendingId = '';
      let pendingUserId = '';
      let pendingPhone = '';
      let pendingEmail = '';
      let pendingPassword = '';

      async function invokeAuth(name, body) {
        if (!window.sb?.functions?.invoke) throw new Error('Auth not ready');
        const { data, error } = await window.sb.functions.invoke(name, { body });
        let payload = data;
        if ((!payload || payload.error) && error) {
          try {
            if (typeof error.context?.json === 'function') payload = await error.context.json();
          } catch (_) {}
        }
        if (payload && payload.error) {
          const err = new Error(payload.error);
          err.payload = payload;
          throw err;
        }
        if (error) throw new Error(error.message || 'Request failed');
        return payload || {};
      }

      function showError(msg) {
        if (errEl) {
          errEl.textContent = msg || 'Something went wrong.';
          errEl.style.display = 'block';
        }
      }

      function showOtpError(msg) {
        otpError.style.color = '';
        otpError.textContent = msg || 'Something went wrong.';
        otpError.style.display = 'block';
      }

      function closeOtp() {
        if (otpOverlay) otpOverlay.style.display = 'none';
        document.body.classList.remove('otp-open');
        if (otpInput) otpInput.value = '';
        if (otpError) otpError.style.display = 'none';
        try {
          document.dispatchEvent(new CustomEvent('vk:visibility', { detail: { visible: false } }));
        } catch (_) {}
      }

      function openOtp(phone, email) {
        pendingPhone = phone;
        if (email) pendingEmail = email;
        const dest = pendingEmail || email || 'your email';
        otpHint.textContent = 'We sent a 6-digit code to ' + dest + '. Your account is created only after this code is verified.';
        otpOverlay.style.display = 'flex';
        document.body.classList.add('otp-open', 'keyboard-visible');
        if (otpInput) otpInput.value = '';
        if (otpError) otpError.style.display = 'none';
        setTimeout(() => {
          try { otpInput.focus({ preventScroll: true }); } catch (_) {
            try { otpInput.focus(); } catch (__) {}
          }
          scheduleLayout();
        }, 40);
      }

      async function afterVerified(session) {
        document.body.classList.remove('otp-open');
        const vk = document.getElementById('vk-auth');
        if (vk) vk.style.display = 'none';
        window.__vkActive = false;
        if (session?.access_token && session?.refresh_token) {
          await window.sb.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        } else {
          showOtpError('Verified. Please sign in with your email or phone and password.');
          setTimeout(() => {
            window.location.href = ncCartId()
              ? 'signin.html?cart=' + encodeURIComponent(ncCartId())
              : 'signin.html';
          }, 1200);
          return;
        }
        const { data: u } = await window.sb.auth.getUser();
        if (u?.user?.id && window.ncPolicy) {
          const agreed = await window.ncPolicy.requireAccepted(window.sb, u.user.id);
          if (!agreed) {
            try { await window.sb.auth.signOut(); } catch (_) {}
            showOtpError('You must accept the Privacy Policy to use NobleCart.');
            return;
          }
        }
        window.location.href = ncCartId()
          ? 'index.html?cart=' + encodeURIComponent(ncCartId())
          : 'index.html';
      }

      const summaryOverlay = document.getElementById('summary-overlay');
      const summaryList = document.getElementById('summary-list');
      const summaryConfirm = document.getElementById('summary-confirm');
      const summaryError = document.getElementById('summary-error');
      const summaryCard = document.querySelector('.summary-card');
      const confirmedSteps = new Set();

      function maskPassword(pw) {
        const s = String(pw || '');
        if (!s) return '—';
        return '•'.repeat(Math.min(s.length, 12)) + (s.length > 12 ? '…' : '');
      }

      function summaryValue(stepIndex) {
        if (stepIndex === 0) return (nameEl?.value || '').trim() || '—';
        if (stepIndex === 1) return getDobDisplay() || '—';
        if (stepIndex === 2) return (phoneEl?.value || '').trim() || '—';
        if (stepIndex === 3) return (emailEl?.value || '').trim() || '—';
        if (stepIndex === 4) return maskPassword(pwEl?.value);
        return '—';
      }

      function refreshSummaryConfirm() {
        if (!summaryConfirm) return;
        summaryConfirm.disabled = confirmedSteps.size < steps.length;
      }

      function setSummaryLoading(on) {
        if (!summaryCard) return;
        summaryCard.classList.toggle('is-loading', !!on);
        if (summaryConfirm) summaryConfirm.disabled = !!on || confirmedSteps.size < steps.length;
      }

      function closeSummary() {
        if (summaryOverlay) {
          summaryOverlay.style.display = 'none';
          summaryOverlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('summary-open');
        setSummaryLoading(false);
        if (summaryError) summaryError.style.display = 'none';
      }

      function openSummary() {
        confirmedSteps.clear();
        if (!summaryList) return;
        summaryList.innerHTML = '';
        steps.forEach((field, i) => {
          const label = field.dataset.stepLabel || ('Step ' + (i + 1));
          const li = document.createElement('li');
          li.className = 'summary-row';
          li.dataset.stepIndex = String(i);
          li.innerHTML =
            '<button type="button" class="summary-act summary-act--bad" data-act="edit" aria-label="Edit ' + label + '">✕</button>' +
            '<div class="summary-row-body">' +
              '<span class="summary-row-label">' + label + '</span>' +
              '<span class="summary-row-value"></span>' +
            '</div>' +
            '<button type="button" class="summary-act summary-act--good" data-act="ok" aria-label="Confirm ' + label + '">✓</button>';
          li.querySelector('.summary-row-value').textContent = summaryValue(i);
          summaryList.appendChild(li);
        });
        refreshSummaryConfirm();
        if (summaryError) summaryError.style.display = 'none';
        setSummaryLoading(false);
        summaryOverlay.style.display = 'flex';
        summaryOverlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('summary-open');
        document.body.classList.remove('keyboard-visible');
        const vk = document.getElementById('vk-auth');
        if (vk) vk.style.display = 'none';
        window.__vkActive = false;
      }

      summaryList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.summary-act');
        const row = e.target.closest('.summary-row');
        if (!btn || !row) return;
        const idx = Number(row.dataset.stepIndex);
        if (Number.isNaN(idx)) return;
        const act = btn.dataset.act;
        if (act === 'edit') {
          closeSummary();
          goToStep(idx, { force: true });
          return;
        }
        if (act === 'ok') {
          confirmedSteps.add(idx);
          row.classList.add('is-ok');
          refreshSummaryConfirm();
        }
      });

      summaryConfirm?.addEventListener('click', async () => {
        if (summaryConfirm.disabled) return;
        if (summaryError) summaryError.style.display = 'none';
        setSummaryLoading(true);

        const fullName = (nameEl?.value || '').trim();
        const phone = (phoneEl?.value || '').trim();
        const email = (emailEl?.value || '').trim();
        const password = (pwEl?.value || '').trim();
        const dobIso = dobToIso(getDobDisplay());

        try {
          if (!window.sb) throw new Error('Auth not ready');
          if (!window.ncPolicy) throw new Error('Privacy Policy unavailable. Please try again.');

          const data = await invokeAuth('auth-signup', {
            full_name: fullName,
            date_of_birth: dobIso,
            phone,
            email,
            password,
          });

          pendingId = data.pending_id || '';
          pendingUserId = data.user_id || '';
          pendingEmail = data.email || email;
          pendingPassword = password;
          closeSummary();
          openOtp(data.phone || phone, pendingEmail);
        } catch (ex) {
          setSummaryLoading(false);
          const msg = ex?.message || '';
          if (summaryError) {
            summaryError.textContent = /rate limit|too many/i.test(msg)
              ? 'Too many signups right now. Please try again in a few minutes.'
              : (msg || 'Failed to start signup.');
            summaryError.style.display = 'block';
          }
        }
      });

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errEl) errEl.style.display = 'none';

        for (let i = 0; i < steps.length; i++) {
          const err = validateStep(i);
          if (err) {
            goToStep(i);
            showStepHint(i, err);
            showError(err);
            return;
          }
        }

        openSummary();
      });

      otpVerifyBtn?.addEventListener('click', async () => {
        const code = (otpInput.value || '').trim();
        if (!code) return;
        otpError.style.display = 'none';
        try {
          const data = await invokeAuth('auth-verify-otp', {
            phone: pendingPhone,
            code,
            password: pendingPassword,
          });
          await afterVerified(data.session);
        } catch (e) {
          showOtpError(e.message || 'Invalid code');
        }
      });

      otpResendBtn?.addEventListener('click', async () => {
        otpError.style.display = 'none';
        try {
          await invokeAuth('auth-resend-otp', { phone: pendingPhone });
          otpError.style.color = '#166534';
          otpError.textContent = 'Code resent.';
          otpError.style.display = 'block';
        } catch (e) {
          showOtpError(e.message || 'Could not resend code.');
        }
      });

      otpWrongBtn?.addEventListener('click', () => {
        closeOtp();
        goToStep(3, { force: true });
      });
      window.ncCreateBoot = 'ready';
      } catch (err) {
        window.ncCreateBoot = 'error';
        window.ncCreateErr = String(err && err.stack || err);
        console.error('create-account init failed', err);
      }
    })();
