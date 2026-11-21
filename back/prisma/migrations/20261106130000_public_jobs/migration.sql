-- Emplois salariés chez un employeur public : le salarié n'a pas d'entreprise de joueur, il porte le métier du catalogue.
ALTER TABLE "employee" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "employee" ADD COLUMN "publicJobId" VARCHAR(32);
ALTER TABLE "employee" ADD CONSTRAINT "employee_employer_check" CHECK ("companyId" IS NOT NULL OR "publicJobId" IS NOT NULL);
CREATE INDEX "employee_publicJobId_idx" ON "employee"("publicJobId");

-- Plafond du salaire brut d'une offre de joueur : 80 000 FCFA (réglage déjà enregistré mis à jour si présent).
UPDATE "game_setting" SET "value" = jsonb_set("value", '{maxGross}', '80000'::jsonb)
WHERE "key" = 'company.playerJobs' AND jsonb_typeof("value") = 'object';
UPDATE "job_offer" SET "grossMonthly" = 80000 WHERE "grossMonthly" > 80000;

-- Métiers sans diplôme : gain par service ramené pour qu'un mois de 26 services reste entre le SMIG (52 500) et 80 000 FCFA.
UPDATE "job" SET "payPerShift" = v.pay FROM (VALUES
  ('car_washer', 2100), ('street_vendor', 2300), ('cyber_attendant', 2400), ('maquis_waiter', 2500), ('shop_clerk', 2600),
  ('zem_driver', 2700), ('agent_securite', 2700), ('vendeur_mode', 2800), ('agent_commercial', 2900), ('delivery_driver', 3050)
) AS v(id, pay) WHERE "job"."id" = v.id AND "job"."level" = 'DEBROUILLE';
