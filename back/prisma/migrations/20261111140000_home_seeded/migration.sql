-- Meubles d'origine du logement donnés au joueur (déplaçables, rangeables, donnables, revendables)
ALTER TABLE "character" ADD COLUMN "homeSeeded" VARCHAR(120) NOT NULL DEFAULT '';
