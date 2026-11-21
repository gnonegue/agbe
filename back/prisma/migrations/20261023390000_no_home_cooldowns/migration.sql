-- Boutons de la maison toujours actifs : plus de délai entre deux musiques, télés, lectures ou siestes (la sieste dure déjà 2 h de jeu).
UPDATE game_setting SET value = jsonb_set(value, '{cooldownGameHours}', '0'::jsonb) WHERE key IN ('action.music', 'action.tv', 'action.read', 'action.rest');
