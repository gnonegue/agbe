import { describe, expect, it } from 'vitest';
import { checkMessage, cleanText, squash } from './filter';

const opts = { maxLength: 280, blockedWords: ['connard'] };

describe('filtre du chat', () => {
  it('nettoie les espaces et les caractères invisibles', () => {
    expect(cleanText('  salut\u200b   Lomé \n ')).toBe('salut Lomé');
    expect(squash('Ça Va 4 l0mé')).toBe('cavaalome');
  });

  it('accepte un message normal', () => {
    expect(checkMessage('Qui va au marché d’Adawlato ce soir ?', opts)).toEqual({ ok: true, text: 'Qui va au marché d’Adawlato ce soir ?' });
  });

  it('bloque la vente contre de l’argent réel, même déguisée', () => {
    expect(checkMessage('10 millions pour 3000 en vrai argent', opts)).toMatchObject({ code: 'chat_real_money' });
    expect(checkMessage('je vends par M-o-M-o, payment first', opts)).toMatchObject({ code: 'chat_real_money' });
    expect(checkMessage('10b for 3k real money', opts)).toMatchObject({ code: 'chat_real_money' });
    expect(checkMessage('envoie par T-Money', opts)).toMatchObject({ code: 'chat_real_money' });
  });

  it('bloque les numéros et les liens', () => {
    expect(checkMessage('appelle moi 90 12 34 56', opts)).toMatchObject({ code: 'chat_contact' });
    expect(checkMessage('va sur arnaque.com', opts)).toMatchObject({ code: 'chat_contact' });
  });

  it('applique la liste de mots interdits et la longueur', () => {
    expect(checkMessage('espèce de C0NNARD', opts)).toMatchObject({ code: 'chat_blocked_word' });
    expect(checkMessage('a'.repeat(281), opts)).toMatchObject({ code: 'chat_too_long' });
    expect(checkMessage('   ', opts)).toMatchObject({ code: 'chat_empty' });
  });
});
