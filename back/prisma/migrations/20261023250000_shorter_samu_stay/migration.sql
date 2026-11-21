-- Séjour SAMU raccourci : 3 h de jeu (environ 7 min réelles) au lieu de 8 h (environ 20 min), si le réglage a déjà été enregistré.
UPDATE game_setting SET value = jsonb_set(value, '{stayGameHours}', '3'::jsonb) WHERE key = 'emergency.samu' AND (value->>'stayGameHours')::int > 3;
