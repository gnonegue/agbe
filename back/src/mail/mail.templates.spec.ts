import { describe, expect, it } from 'vitest';
import { renderPasswordChangedMail, renderResetMail } from './mail.templates';

describe('Gabarits e-mail', () => {
  const link = 'https://agbe.tg/?reset=abc_DEF-123';

  it('contient le lien, la durée et le nom dans les deux langues', () => {
    for (const locale of ['fr', 'en'] as const) {
      const m = renderResetMail({ locale, name: 'kofi', link, minutes: 60 });
      expect(m.html).toContain(`href="${link}"`);
      expect(m.html).toContain('kofi');
      expect(m.html).toContain('60');
      expect(m.text).toContain(link);
      expect(m.html).toContain('src="cid:agbe-logo"');
      expect(m.subject.length).toBeGreaterThan(5);
    }
    expect(renderResetMail({ locale: 'fr', name: null, link, minutes: 60 }).subject).toContain('AGBE');
    expect(renderResetMail({ locale: 'en', name: null, link, minutes: 60 }).html).toContain('lang="en"');
  });

  it('échappe tout texte variable (nom, lien)', () => {
    const m = renderResetMail({ locale: 'fr', name: '<script>alert(1)</script>', link: 'https://x.tg/?a="><img src=x>', minutes: 60 });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('"><img');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('distingue le lien demandé par un administrateur', () => {
    const self = renderResetMail({ locale: 'fr', name: 'a', link, minutes: 60 });
    const admin = renderResetMail({ locale: 'fr', name: 'a', link, minutes: 60, byAdmin: true });
    expect(admin.text).not.toBe(self.text);
    expect(admin.text).toContain('équipe AGBE');
  });

  it('prévient quand le mot de passe a été changé', () => {
    const m = renderPasswordChangedMail({ locale: 'en', name: 'ama', loginUrl: 'https://agbe.tg' });
    expect(m.subject).toContain('changed');
    expect(m.html).toContain('href="https://agbe.tg"');
  });
});
