-- AlterTable
ALTER TABLE "account" ADD COLUMN     "mfaFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaLockedUntil" TIMESTAMP(3),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ledger_transaction" ADD COLUMN     "requestHash" VARCHAR(64);

-- AlterTable
ALTER TABLE "purchase" ADD COLUMN     "coinsGranted" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "authAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ───────────── Moindre privilège (production) ─────────────
-- Si le rôle applicatif `agbe_app` existe (créé par infra/db-init.sh), il ne reçoit que les droits nécessaires.
-- Le rôle propriétaire ne sert qu'aux migrations. Le grand livre est en ajout seul, même pour l'application.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agbe_app') THEN
    GRANT USAGE ON SCHEMA public TO agbe_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agbe_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entry", "ledger_transaction", "payment_event", "audit_log" FROM agbe_app;
    REVOKE ALL ON "_prisma_migrations" FROM agbe_app;
    GRANT UPDATE ("ip") ON "audit_log" TO agbe_app; -- anonymisation à la suppression de compte
  END IF;
END $$;
