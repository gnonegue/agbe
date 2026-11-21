-- Réinitialisation du mot de passe par e-mail : jeton à usage unique (seul son SHA-256 est stocké).
CREATE TABLE "password_reset" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "byAdmin" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokenHash_key" ON "password_reset"("tokenHash");
CREATE INDEX "password_reset_accountId_idx" ON "password_reset"("accountId");

ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
