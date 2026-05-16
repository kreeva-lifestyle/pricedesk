-- Lock down direct anon INSERT to pd_audit_log.
-- All audit writes now go through the audit-log-write Edge Function
-- (service-role). The Edge Function validates shape/length and uses
-- the database NOW() for ts so timestamps cannot be forged.

DROP POLICY IF EXISTS "audit_insert_only" ON pd_audit_log;

-- Keep SELECT open for the client UI that renders the audit page.
-- (Locking SELECT down further requires a real auth/JWT model — separate work.)
-- audit_select_only policy remains unchanged.
