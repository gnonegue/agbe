-- Retour des achats « Consultation » et « Test de paludisme » des hôpitaux, mais limités à une fois par jour de jeu (réglage activities.oncePerDay).
UPDATE venue_activity SET enabled = true WHERE id IN ('chr_consult', 'chr_palu', 'dogta_consult', 'dogta_palu', 'chu_consult', 'chu_palu', 'kpal_consult', 'sok_consult', 'dap_consult');
