# Security Vulnerability Report

**Date:** 2026-02-01
**Target:** NobelCart-Full Codebase
**Status:** CRITICAL VULNERABILITIES FOUND

## Executive Summary
This audit has identified **3 Critical** and **2 High** severity vulnerabilities that could allow a malicious actor to completely compromise the application, bypass authentication, assume administrative privileges, and leak sensitive user data. The application relies heavily on client-side security controls, which are trivially bypassable.

---

## 1. Client-Side Admin Privilege Bypass (Critical)
**File:** `admin/index.html`, `admin/monitor.html`
**Description:**
The application checks if a user is an administrator using JavaScript running in the user's browser:
```javascript
// admin/index.html lines 59-60
const { data: prof } = await window.sb.from('profiles').select('is_admin')....
if (!prof || !prof.is_admin) { alert('Admin access required.'); ... }
```
**Exploit:**
An attacker can easily bypass this check by:
1. Using the browser console to overwrite the check.
2. using a proxy (like Burp Suite) to modify the boolean response from the database to `true`.
3. Simply manually navigating to the page and disabling JavaScript breakpoint triggers.

**Remediation:**
Security checks MUST be enforced on the server (Database).
- **Action:** Enable **Row Level Security (RLS)** policies on the Supabase `profiles` table.
- **Policy:** Only allow users to read the `admin` section if their JWT claims contain a specific role, or ensure the data returned respects the policy.

## 2. Insecure "Admin" Account Creation (Critical)
**File:** `signin.html` (Lines 442-451)
**Description:**
The login logic attempts to *automatically create* an admin account if a login attempt for "admin" fails:
```javascript
if (isAdminHandle && /Invalid login credentials/i.test(error.message)) {
  const signup = await window.sb.auth.signUp({ email, password });
  // ... logs them in ...
}
```
**Exploit:**
An attacker who knows or guesses that the admin email is `admin@example.com` can simply attempt to log in. If the account doesn't exist (or acts strangely), the code *creates* it for them with the password *they provided*. This is a backdoor logic flaw.

**Remediation:**
- **Action:** REMOVE this entire block of code immediately. Admin accounts should only be created manually in the Supabase dashboard or via a protected database seed script.

## 3. Data Leakage via `active_sessions` (High)
**File:** `admin/monitor.html`
**Description:**
The admin monitor fetches all user sessions:
```javascript
window.sb.from('active_sessions').select('*')...
```
If specific Row Level Security (RLS) policies are not set up on the `active_sessions` table to restrict this query to *only* admins, **any logged-in user** can run this exact query using the public `SUPABASE_ANON_KEY` found in `config.js` and dump the entire table.

**Exploit:**
1. Log in as a normal user.
2. Open Browser Console.
3. Run `await window.sb.from('active_sessions').select('*')`.
4. View all user emails, device IDs, and cart totals.

**Remediation:**
- **Action:** Enable RLS on `active_sessions`.
- **Policy:** `CREATE POLICY "Admins only" ON active_sessions FOR SELECT TO authenticated USING ( (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true );`

## 4. Exposed Supabase Configuration (Medium)
**File:** `config.js`
**Description:**
The `SUPABASE_URL` and `SUPABASE_ANON_KEY` are exposed in the client-side code.
**Risk:**
While "Anon" keys are designed to be public, they are ONLY safe if the database tables have RLS enabled. Given the findings above (reliance on client-side checks), it is highly likely that RLS is missing or misconfigured, turning this key into a "master key" for the database.

**Remediation:**
- **Action:** strictly verify that **EVERY** table in Supabase (`profiles`, `receipts`, `active_sessions`, etc.) has RLS enabled and default "deny all" policies apply to the Anon role.

---

## Remediation Status (Updated)

### Fixed ✅
1. **Insecure Admin Creation (Backdoor)**: I have patched `signin.html` to remove the logic that automatically created admin accounts. The login form now strictly verifies credentials.

### Requires Action ⚠️
2. **Database Permissions (RLS)**: The vulnerabilities in `admin/index.html` (Bypass) and `admin/monitor.html` (Data Leak) generally cannot be fixed by changing HTML/JS files alone. They require server-side enforcement.
   - **Solution**: I have created a file named `security_patches.sql`.
   - **Action**: Open your Supabase Dashboard -> SQL Editor -> Copy/Paste the contents of `security_patches.sql` -> Click "Run".

### Summary of Remaining Risks
Until you run the SQL script, the "Admin" pages are still technically accessible to a hacker who knows how to manipulate the browser, although removing the backdoor makes it harder for them to get an initial account to try it with.

