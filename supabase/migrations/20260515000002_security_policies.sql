-- Security hardening: restrict audit log to INSERT-only for anon role
-- Prevents users from modifying or deleting audit trail entries

-- Drop the permissive policy and replace with restricted ones
DROP POLICY IF EXISTS "allow_all_audit" ON pd_audit_log;

-- Allow anyone to INSERT audit entries (needed for client-side audit() calls)
CREATE POLICY "audit_insert_only" ON pd_audit_log
  FOR INSERT
  USING (true)
  WITH CHECK (true);

-- Allow anyone to SELECT audit entries (needed for renderAuditLog)
CREATE POLICY "audit_select_only" ON pd_audit_log
  FOR SELECT
  USING (true);

-- UPDATE and DELETE are NOT allowed via anon key
-- Only service_role (Edge Functions) can modify/delete audit entries
