-- Prêt bancaire personnel : emprunteur = le personnage, un seul prêt actif (OPEN/LATE) à la fois.
CREATE TYPE "LoanStatus" AS ENUM ('OPEN', 'LATE', 'CLOSED');

CREATE TABLE "loan" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "principal" BIGINT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "termDays" INTEGER NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "installmentAmount" BIGINT NOT NULL,
    "remaining" BIGINT NOT NULL,
    "nextDueGameDay" INTEGER NOT NULL,
    "lateSinceGameDay" INTEGER,
    "totalPenaltyPaid" BIGINT NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'OPEN',
    "createdGameDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loan_characterId_status_idx" ON "loan"("characterId", "status");
