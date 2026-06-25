-- Append-only audit log (plan §11, §12).
--
-- Run ONCE in production against the ProxyClaude database, as the DB owner,
-- to ensure the application role can INSERT and SELECT audit rows but never
-- UPDATE or DELETE them. Replace :app_role with the least-privilege role the
-- API connects as (NOT the migration/owner role).
--
--   psql "$DATABASE_URL" -v app_role=proxyclaude_app -f append-only-audit.sql
--
-- In local dev the app connects as the owner, so this is not applied there.

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM :"app_role";
GRANT INSERT, SELECT ON TABLE "AuditLog" TO :"app_role";

-- Defense in depth: block row mutation even if a grant is ever widened.
CREATE OR REPLACE FUNCTION proxyclaude_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON "AuditLog";
CREATE TRIGGER audit_no_update
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION proxyclaude_audit_immutable();
