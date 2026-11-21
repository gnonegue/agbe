-- Logo facultatif d'un partenaire (bâtiment de marque et fiche).
CREATE TABLE "partner_logo" (
    "partnerId" UUID NOT NULL,
    "mime" VARCHAR(16) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_logo_pkey" PRIMARY KEY ("partnerId")
);

ALTER TABLE "partner_logo" ADD CONSTRAINT "partner_logo_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
