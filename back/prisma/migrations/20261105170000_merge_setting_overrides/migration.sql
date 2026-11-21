-- Réglages déjà enregistrés par l'administration : ils prévalent sur les valeurs par défaut du code, donc on y fusionne ici
-- les cinq métiers Yas Togo (lieu de travail et diplômes), le rattachement de l'administrateur réseaux à Yas et le nom SODIGAZ
-- de la recharge de gaz. Sans ligne enregistrée (cas courant), les valeurs par défaut du code s'appliquent : rien à faire.
-- Idempotent : rejouable sans effet de bord.
UPDATE "game_setting"
SET "value" = "value" || '{"agent_commercial_yas":"yas","charge_communication":"yas","developpeur_mobile":"yas","chef_projet_telecom":"yas","directeur_communication":"yas","administrateur_reseaux":"yas"}'::jsonb
WHERE "key" = 'work.places' AND jsonb_typeof("value") = 'object';

UPDATE "game_setting"
SET "value" = jsonb_set(
  "value",
  '{jobReq}',
  COALESCE("value"->'jobReq', '{}'::jsonb) || '{
    "agent_commercial_yas": {"min":"BT","domains":["commerce","telecoms"]},
    "charge_communication": {"min":"LICENCE","domains":["journalisme","commerce"]},
    "developpeur_mobile": {"min":"LICENCE","domains":["informatique"]},
    "chef_projet_telecom": {"min":"MASTER","domains":["telecoms","informatique"]},
    "directeur_communication": {"min":"MASTER","domains":["journalisme","commerce"]}
  }'::jsonb
)
WHERE "key" = 'study' AND jsonb_typeof("value") = 'object';

UPDATE "game_setting"
SET "value" = jsonb_set(
  "value",
  '{items}',
  (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN e->>'id' = 'gaz'
        THEN e || '{"nameFr":"Recharge de gaz SODIGAZ (20 cuissons)","nameEn":"SODIGAZ gas refill (20 meals)"}'::jsonb
        ELSE e END
    ), '[]'::jsonb)
    FROM jsonb_array_elements("value"->'items') AS e
  )
)
WHERE "key" = 'kitchen' AND jsonb_typeof("value"->'items') = 'array';
