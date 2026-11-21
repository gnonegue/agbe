import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Identifiant du lieu de jeu d'un bâtiment de marque (préfixe `brand_`, stable pour un partenaire). */
export const brandVenueId = (partnerId: string): string => `brand_${partnerId.replace(/-/g, '').slice(0, 20)}`;

/**
 * Chaque partenaire qui tient un emplacement (formule en cours, lieu de marque actif) a un vrai lieu de jeu à l'endroit de son
 * bâtiment : on peut s'y rendre, y acheter ce que propose son modèle (soins, repas, repos…) et y travailler. Les services viennent
 * du réglage `partners.services` ; les lieux de partenaires qui ne remplissent plus les conditions sont désactivés (jamais supprimés :
 * l'historique du joueur y fait référence).
 */
@Injectable()
export class BrandVenuesService implements OnModuleInit {
  private readonly log = new Logger(BrandVenuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sync();
    } catch (e) {
      this.log.warn(`synchro des lieux de marque impossible : ${(e as Error).message}`);
    }
  }

  async sync(): Promise<void> {
    const tiers = await this.settings.get('partners.tiers');
    const services = await this.settings.get('partners.services');
    const now = new Date();
    const partners = await this.prisma.partner.findMany({ where: { placeX: { not: null }, placeZ: { not: null } } });
    const live = new Set<string>();
    for (const p of partners) {
      const tier = p.tier !== 'NONE' && (!p.tierEndsAt || p.tierEndsAt > now) ? p.tier : 'NONE';
      const ok = p.active && tier !== 'NONE' && tiers[tier as 'BRONZE' | 'SILVER' | 'GOLD'].brandPlace;
      const id = brandVenueId(p.id);
      if (!ok) continue;
      live.add(id);
      const model = (p.placeModel ?? 'agency') as keyof typeof services;
      const svc = services[model] ?? services.agency;
      const name = (p.placeLabel ?? p.name).slice(0, 64);
      const data = {
        emoji: svc?.emoji ?? '🏬',
        nameFr: name,
        nameEn: name,
        districtFr: 'Lieu partenaire',
        districtEn: 'Partner venue',
        descFr: `${p.name}, partenaire d’AGBE. Un lieu de marque ouvert à tous les joueurs.`,
        descEn: `${p.name}, an AGBE partner. A branded venue open to every player.`,
        city: 'lome',
        x: p.placeX!,
        z: p.placeZ!,
        app: svc?.app ?? null,
        enabled: true,
      };
      await this.prisma.venue.upsert({ where: { id }, create: { id, ...data }, update: data });
      // Activités : remplacées par celles du modèle (les prix se règlent dans l'admin, réglage partners.services)
      await this.prisma.$transaction([
        this.prisma.venueActivity.deleteMany({ where: { venueId: id } }),
        this.prisma.venueActivity.createMany({ data: (svc?.activities ?? []).map((a, i) => ({ id: `${id}_${i}`, venueId: id, sort: i, ...a })) }),
      ]);
    }
    await this.prisma.venue.updateMany({ where: { id: { startsWith: 'brand_' }, ...(live.size ? { NOT: { id: { in: [...live] } } } : {}) }, data: { enabled: false } });
  }
}
