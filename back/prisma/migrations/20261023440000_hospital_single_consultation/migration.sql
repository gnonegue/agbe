-- Une seule consultation à l'hôpital : le parcours de l'application Santé (consultation, analyses, traitement). Les achats « Consultation » et
-- « Test de paludisme » de la fiche des hôpitaux, qu'on pouvait refaire sans fin et qui doublonnaient le parcours, sont désactivés.
UPDATE venue_activity SET enabled = false WHERE id IN ('chr_consult', 'chr_palu', 'dogta_consult', 'dogta_palu', 'chu_consult', 'chu_palu', 'kpal_consult', 'sok_consult', 'dap_consult');
