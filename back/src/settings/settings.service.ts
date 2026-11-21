import { BadRequestException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { ClockConfig } from '../economy/clock';
import { DEFAULT_TOPICS } from '../conference/topics';
import { DEFAULT_COURSES } from '../school/courses';
import { DEFAULT_DOMAINS } from '../study/content';
import { DEFAULT_GARMENTS } from '../clothes/catalog';
import { STYLES } from '../economy/clothes';

// Chaque paramètre a un schéma strict : le back-office ne peut pas enregistrer une valeur invalide.
const int = (min = 0, max = 1_000_000_000) => z.number().int().min(min).max(max);
const bp = int(0, 100_000);
const transportMode = z.object({ base: int(0, 100_000), perKm: int(0, 100_000), roundTo: int(1, 1000), energyPerKm: int(0, 50), riskBp: bp }).strict();
const point = z.object({ x: z.number().int().min(-500).max(500), z: z.number().int().min(-500).max(500) }).strict();
const cycle = z.object({ years: int(1, 10), fee: int(0, 100_000_000), sessionsPerYear: int(1, 30) }).strict();
/** Modèles de maison dessinés (le style suit le modèle de construction choisi sur un terrain). */
export const HOUSE_STYLES = ['hut', 'block', 'studio', 'veranda', 'twobed', 'bungalow', 'villa_low', 'duplex', 'villa', 'villa_pool', 'immeuble'] as const;
const conditionMap = <T extends z.ZodTypeAny>(t: T) => z.object({ RICH: t, MIDDLE: t, POOR: t }).strict();

export const SETTING_SCHEMAS = {
  'game.clock': z.object({ epochRealMs: int(0, 10_000_000_000_000), secondsPerGameDay: int(60, 864_000) }).strict(),
  'needs.decay': z
    .object({
      perGameHour: z.object({ hunger: int(0, 100), energy: int(0, 100), hygiene: int(0, 100), morale: int(0, 100) }).strict(),
      maxDecayGameHours: int(0, 720),
      healthLossWhenStarving: int(0, 100),
      /** Absence d'au moins ce nombre d'heures de jeu : les jauges ne descendent pas sous `offlineFloor` et la santé n'en souffre pas. */
      offlineAfterGameHours: int(1, 48).default(3),
      offlineFloor: int(0, 100).default(25),
    })
    .strict(),
  // Repas : un plat qui apporte au moins `minHunger` points de faim remonte l'énergie à `energyFloor` au minimum.
  'food.meal': z.object({ minHunger: int(0, 100), energyFloor: int(0, 100) }).strict(),
  // Nombre de métiers qu'un personnage peut occuper en même temps (chacun garde son propre délai entre séances)
  'work.maxJobs': int(1, 10),
  'start.capital': conditionMap(int()),
  'start.housing': conditionMap(z.enum(['VILLA', 'CHAMBRE_SALON', 'ENTRER_COUCHER'])),
  'rent.monthly': z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(),
  // Factures mensuelles (FCFA) selon le logement ; wifi : forfait box unique
  // Électricité : abonnement par logement + consommation (éclairage du logement, appareils installés, cuissons au réchaud électrique),
  // facturée par tranches de kWh comme à la CEET ; les panneaux solaires couvrent une part de la consommation
  'bills.power': z
    .object({
      subscription: z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(),
      baseKwh: z.object({ VILLA: int(0, 10_000), CHAMBRE_SALON: int(0, 10_000), ENTRER_COUCHER: int(0, 10_000) }).strict(),
      /** kWh par mois de chaque appareil : meubles du logement (id du meuble) et appareils de cuisine (id), `freezer` pour le congélateur. */
      applianceKwh: z.record(z.string().regex(/^[a-z0-9_]{2,32}$/), int(0, 10_000)),
      cookKwh: int(0, 100),
      solarBp: bp,
      tranches: z.array(z.object({ upToKwh: int(1, 100_000).nullable(), price: int(1, 10_000) }).strict()).min(1).max(6),
    })
    .strict(),
  // Eau : abonnement par logement + consommation (besoins du logement, douches, cuisine), facturée par tranches de m³ comme à la TdE
  'bills.water': z
    .object({
      subscription: z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(),
      baseLitres: z.object({ VILLA: int(0, 1_000_000), CHAMBRE_SALON: int(0, 1_000_000), ENTRER_COUCHER: int(0, 1_000_000) }).strict(),
      showerLitres: int(0, 1_000),
      cookLitres: int(0, 1_000),
      tranches: z.array(z.object({ upToM3: int(1, 100_000).nullable(), price: int(1, 100_000) }).strict()).min(1).max(6),
    })
    .strict(),
  'bills.monthly': z.object({ ELEC: z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(), WATER: z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(), WIFI: int() }).strict(),
  'housing.price': z.object({ VILLA: int(), CHAMBRE_SALON: int(), ENTRER_COUCHER: int() }).strict(),
  'destiny.weights': conditionMap(int(0, 1000)),
  'destiny.bonusRespect': int(0, 100),
  // Plafond de personnages par condition de départ (riche, moyen) : au-delà de la part maximale, le choix est fermé et le destin descend d'un cran
  'start.quota': z.object({ RICH: z.object({ maxShareBp: bp, minSlots: int(0, 100_000) }).strict(), MIDDLE: z.object({ maxShareBp: bp, minSlots: int(0, 100_000) }).strict() }).strict(),
  'transfer.fee': z.object({ rateBp: bp, min: int(), max: int() }).strict(),
  // Anti multi-comptes : ancienneté minimale et plafonds glissants sur 24 h réelles.
  'transfer.limits': z.object({ minAccountAgeHours: int(0, 8760), dailySendMax: int(), dailyReceiveMax: int() }).strict(),
  // AMU : part prise en charge à l'hôpital (points de base), adhésion volontaire mensuelle, hôpitaux conventionnés
  amu: z.object({ coverageBp: bp, voluntaryMonthly: int(), hospitals: z.array(z.string().max(48)).max(50) }).strict(),
  // Congélateur : prix d'achat, capacité en portions, remise sur les plats achetés en gros
  'freezer': z.object({ price: int(0, 100_000_000), capacity: int(1, 500), discountBp: int(0, 5_000) }).strict(),
  // Cuisine à la maison : ingrédients et combustibles vendus au marché, appareils, recettes (plats du catalogue `food_item`), péremption
  // Aménagement du logement : catalogue de meubles (empreinte au sol en mètres), emplacements par type de logement, taille des
  // pièces (même repère que la 3D), revente en points de base du prix payé, seuils de standing (somme du confort des meubles)
  'home.furniture': z
    .object({
      resaleBp: bp,
      slots: z.record(z.string().regex(/^[A-Z_]{3,24}$/), int(0, 200)),
      rooms: z.record(z.string().regex(/^[A-Z_]{3,24}$/), z.object({ w: int(2, 100), d: int(2, 100) }).strict()),
      standing: z.object({ comfortable: int(1, 100_000), luxurious: int(1, 100_000) }).strict(),
      /** Valeur de revente (points de base du prix du catalogue) des meubles d'origine et des meubles reçus en cadeau : de quoi limiter les comptes jetables et le contournement des frais de transfert. */
      starterValueBp: bp,
      giftValueBp: bp,
      /** Nombre maximal de meubles rangés (hors logement) par joueur. */
      storageMax: int(1, 500),
      /** Meubles d'origine par type de logement : posés une fois, à la première ouverture, puis ils appartiennent au joueur. */
      starters: z.record(z.string().regex(/^[A-Z_]{3,24}$/), z.array(z.object({ itemId: z.string().regex(/^[a-z0-9_]{2,24}$/), x: z.number().min(-60).max(60), z: z.number().min(-60).max(60), rot: int(0, 3) }).strict()).max(60)),
      items: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,24}$/),
              model: z.string().regex(/^[a-z]{2,16}$/),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(40),
              nameEn: z.string().min(2).max(40),
              price: int(1, 100_000_000),
              w: z.number().min(0.2).max(6),
              d: z.number().min(0.2).max(6),
              comfort: int(0, 1000),
              flat: z.boolean().optional(),
              /** Pas de rotation possible (le lit : le sommeil suppose la tête au nord). */
              fixed: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(80),
    })
    .strict(),
  'kitchen': z
    .object({
      /** Ingrédients et combustibles : prix d'un achat (qui apporte `pack` unités), durée de conservation en jours de jeu (0 = ne se périme pas), lieux de vente. */
      items: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z_]{2,24}$/),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(1).max(60),
              nameEn: z.string().min(1).max(60),
              price: int(1, 10_000_000),
              pack: int(1, 1_000),
              shelfDays: int(0, 365),
              venues: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(1).max(20),
            })
            .strict(),
        )
        .max(60),
      /** Appareils : réfrigérateur (FRIDGE) ou réchaud (STOVE) avec son combustible (CHARCOAL/GAS : une unité du produit `fuelItem` par cuisson ; ELECTRIC : redevance au marché par cuisson). */
      appliances: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z_]{2,24}$/),
              kind: z.enum(['FRIDGE', 'STOVE']),
              fuel: z.enum(['CHARCOAL', 'GAS', 'ELECTRIC']).optional(),
              fuelItem: z.string().regex(/^[a-z_]{2,24}$/).optional(),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(1).max(60),
              nameEn: z.string().min(1).max(60),
              descFr: z.string().max(200),
              descEn: z.string().max(200),
              price: int(0, 100_000_000),
              venues: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(1).max(20),
            })
            .strict(),
        )
        .max(12),
      /** Recettes : un plat du catalogue, les ingrédients d'une préparation, le nombre de portions obtenues et la fatigue de cuisiner. */
      recipes: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z_]{2,24}$/),
              foodId: z.string().regex(/^[a-z_]{2,32}$/),
              portions: int(1, 12),
              effort: int(0, 50),
              items: z.array(z.object({ id: z.string().regex(/^[a-z_]{2,24}$/), qty: int(1, 100) }).strict()).min(1).max(12),
            })
            .strict(),
        )
        .max(40),
      /** Conservation : multiplicateur (points de base) de la durée avec un réfrigérateur, jours de jeu de conservation des restes sans/avec frigo. */
      fridgeShelfBp: int(10_000, 100_000),
      leftoverDays: int(1, 30),
      leftoverFridgeDays: int(1, 60),
      /** Un plat cuisiné à la maison : bonus de moral en plus des effets du plat. */
      homeMoraleBonus: int(0, 20),
      /** Redevance d'électricité par cuisson sur un réchaud électrique (FCFA). */
      electricFee: int(0, 100_000),
      /** Au plus ce nombre de portions de restes gardées en même temps. */
      maxLeftovers: int(0, 100),
    })
    .strict(),
  // Actes de soins qu'on ne peut refaire qu'une fois par jour de jeu (consultation, test) : pas de répétition sans fin au même hôpital
  'activities.oncePerDay': z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(60),
  'action.music': z.object({ moraleGain: int(0, 100), energyGain: int(0, 100), cooldownGameHours: int(0, 48) }).strict(),
  // Loisirs à la maison : regarder la télé (logement équipé) et lire, chacun avec son délai
  'action.tv': z.object({ moraleGain: int(0, 100), energyGain: int(-100, 100), cooldownGameHours: int(0, 48) }).strict(),
  'action.read': z.object({ moraleGain: int(0, 100), energyGain: int(-100, 100), cooldownGameHours: int(0, 48) }).strict(),
  // Loyer en retard : pénalité par mois de retard, expulsion, caution, rappels hebdomadaires du propriétaire
  'rent.rules': z.object({ lateFeeBpPerDay: int(0, 10_000), evictAfterMonths: int(1, 12), depositMonths: int(0, 12), nagRespect: int(0, 50), nagMorale: int(0, 50), evictRespect: int(0, 100), evictMorale: int(0, 100) }).strict(),
  // Sieste : le personnage dort `napGameHours` heures de jeu (0 = repos instantané), puis récupère `energyGain`
  'action.rest': z.object({ energyGain: int(0, 100), cooldownGameHours: int(0, 48), napGameHours: int(0, 6).default(2) }).strict(),
  // Nuit de sommeil : durée en heures de jeu, énergie rendue pour une nuit complète (au prorata si réveil avancé)
  // Nuit : coucher à partir de fromHour (heure de jeu), réveil vers wakeHour, entre minGameHours et maxGameHours de sommeil
  'action.sleep': z.object({ fromHour: int(0, 23), wakeHour: int(0, 23), minGameHours: int(1, 12), maxGameHours: int(1, 12), energyGain: int(0, 100), moraleGain: int(0, 50) }).strict(),
  'action.wash': z.object({ price: int(1), hygieneGain: int(0, 100) }).strict(),
  'payroll.rates': z
    .object({
      smig: int(),
      cnssEmployeeBp: bp,
      cnssEmployerBp: bp,
      amuEmployeeBp: bp,
      amuEmployerBp: bp,
      irppBrackets: z.array(z.object({ from: int(), rateBp: bp }).strict()).max(20),
    })
    .strict(),
  'tax.vatBp': bp,
  // Transport en ville : prise en charge + prix au km, arrondi, fatigue et risque (voir economy/transport.ts).
  // Entreprise : frais et délai CFE (chiffres réels du document, à revérifier avant lancement)
  'company.cfe': z.object({ feeEI: int(), feeSociety: int(), feeSocietyNonEcowas: int(), delayGameHours: int(0, 240) }).strict(),
  // Capital minimum par forme (OHADA : SARL 1 000 000, SA 10 000 000 — à valider pour le Togo)
  'company.capitalMin': z.object({ EI: int(), SARL: int(), SA: int() }).strict(),
  // Cotisations et impôts du TNS (CNSS 21,5 %, AMU forfait ; taux OTR et pénalités à valider)
  'company.contributions': z
    .object({ cnssTnsBp: bp, amuTnsMonthly: int(), otrBp: bp, penaltyBpPerMonth: bp, graceDays: int(0, 29), unregisteredFine: int(), maxEmployees: int(0, 100) })
    .strict(),
  // Chat et présence : longueur, délai entre deux messages, historique, masquage automatique après N signalements, mots interdits
  'chat': z
    .object({
      maxLength: int(20, 500),
      minIntervalSeconds: int(0, 600),
      historySize: int(10, 200),
      autoHideReports: int(1, 50),
      minAccountAgeHours: int(0, 720),
      blockedWords: z.array(z.string().min(3).max(32)).max(500),
      presenceMax: int(5, 200),
      // Groupes de discussion : groupes par joueur et membres par groupe (créateur compris)
      groupsMax: int(1, 100).default(10),
      groupMembersMax: int(2, 200).default(20),
    })
    .strict(),
  // Tontine : cotisation min/max, durées de tour possibles (jours de jeu), taille, pénalité de respect par tour manqué,
  // tontines actives par joueur, tours manqués au-delà desquels on ne peut plus rejoindre, ancienneté minimale du compte
  'tontine': z
    .object({
      minContribution: int(100),
      maxContribution: int(100),
      periods: z.array(int(1, 90)).min(1).max(6),
      minMembers: int(2, 50),
      maxMembers: int(2, 50),
      missRespect: int(0, 100),
      missMorale: int(0, 100),
      maxActive: int(1, 20),
      maxDefaultsToJoin: int(0, 100),
      minAccountAgeHours: int(0, 720),
    })
    .strict()
    .refine((v) => v.minContribution <= v.maxContribution && v.minMembers <= v.maxMembers),
  // Marché entre joueurs : marchandises (prix de gros, marge maximale en points de base, effets à l'usage)
  'market.goods': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          emoji: z.string().min(1).max(16),
          nameFr: z.string().min(2).max(64),
          nameEn: z.string().min(2).max(64),
          wholesale: int(1, 10_000_000),
          maxMarkupBp: int(10_000, 100_000),
          effects: z.object({ hunger: int(-100, 100), energy: int(-100, 100), hygiene: int(-100, 100), health: int(-100, 100), morale: int(-100, 100), respect: int(-100, 100) }).partial().strict(),
        })
        .strict(),
    )
    .max(100),
  // Règles du marché : marchés où l'on peut louer un étal, loyer par semaine de jeu, taxe de marché sur les ventes,
  // stock maximal par marchandise, rangs de revendeuse selon les ventes cumulées
  'market.rules': z
    .object({
      venues: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(1).max(30),
      weeklyRent: int(0, 10_000_000),
      maxWeeks: int(1, 52),
      taxBp: bp,
      maxStock: int(1, 100_000),
      maxBuy: int(1, 1000),
      ranks: z.array(z.object({ id: z.string().regex(/^[a-z_]{2,24}$/), minSales: int(0, 1_000_000_000_000) }).strict()).min(1).max(10),
    })
    .strict(),
  // Habillement : vêtements vendus en boutique (emplacement, coupe homme/femme/mixte, coupe dessinée, tissu, prix public)
  'clothes.items': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          slot: z.enum(['top', 'bottom', 'dress', 'shoes']),
          gender: z.enum(['m', 'f', 'u']),
          style: z.string().regex(/^[a-z_]{2,16}$/),
          fabric: z.enum(['plain', 'wax', 'kente', 'batik']),
          color: int(0, 0xffffff),
          pattern: int(0, 63),
          price: int(1, 10_000_000),
          emoji: z.string().min(1).max(16),
          nameFr: z.string().min(2).max(64),
          nameEn: z.string().min(2).max(64),
        })
        .strict()
        .refine((v) => STYLES[v.slot].includes(v.style), { message: 'style_not_for_slot' }),
    )
    .min(1)
    .max(200),
  // Boutiques de vêtements : lieux, location d'une boutique par un joueur (loyer par semaine de jeu), taxe sur ses ventes,
  // stock maximal par article, achat en gros (part du prix public) et prix de vente maximal (part du prix public)
  'clothes.rules': z
    .object({
      venues: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(1).max(30),
      weeklyRent: int(0, 10_000_000),
      maxWeeks: int(1, 52),
      taxBp: bp,
      maxStock: int(1, 10_000),
      maxBuy: int(1, 100),
      wholesaleBp: int(100, 10_000),
      maxPriceBp: int(10_000, 50_000),
      /** Fermeture de la boutique : part du prix de gros rendue pour le stock invendu, et part du loyer non consommé remboursée. */
      closeBuybackBp: bp.default(5_000),
      closeRentRefundBp: bp.default(5_000),
      /** Clients du quartier (PNJ) : passages par jour de jeu dans chaque boutique ouverte et rattrapage maximal (jours) après une absence. */
      npcVisitsPerDay: int(0, 200).default(2),
      npcMaxCatchUpDays: int(1, 30).default(3),
    })
    .strict(),
  // Santé : maladies courantes (poids relatif de tirage, perte quotidienne, prix du traitement, guérison spontanée en jours, 0 = jamais)
  'health.illnesses': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          nameFr: z.string().min(2).max(64),
          nameEn: z.string().min(2).max(64),
          weight: int(0, 1000),
          dailyHealth: int(0, 100),
          dailyEnergy: int(0, 100),
          treatment: int(0, 10_000_000),
          selfHealDays: int(0, 365),
        })
        .strict(),
    )
    .min(1)
    .max(30),
  // Risque quotidien de tomber malade (points de base), majoré si l'hygiène ou la santé sont basses ; prix de la consultation ; santé rendue par le traitement
  'health.rules': z
    .object({ dailyRiskBp: bp, dirtyBelow: int(0, 100), dirtyMultiplierBp: int(10_000, 100_000), weakBelow: int(0, 100), weakMultiplierBp: int(10_000, 100_000), consultPrice: int(0, 10_000_000), healOnTreat: int(0, 100), maxCatchUpDays: int(1, 60) })
    .strict(),
  // Concession, carburant et entretien : motos et voitures achetables (consommation en ml/km, entretien tous les X km).
  'vehicles.catalog': z
    .object({
      models: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              kind: z.enum(['MOTO', 'CAR']),
              nameFr: z.string().min(2).max(64),
              nameEn: z.string().min(2).max(64),
              emoji: z.string().max(8),
              descFr: z.string().max(200),
              descEn: z.string().max(200),
              price: int(1, 1_000_000_000),
              tankL: int(1, 200),
              mlPerKm: int(1, 1000),
              serviceEveryKm: int(50, 100_000),
              serviceCost: int(0, 10_000_000),
              repairCost: int(0, 10_000_000),
              seats: int(1, 20),
            })
            .strict(),
        )
        .max(40),
      fuelPricePerL: int(1, 100_000),
      /**
       * Plein à distance (livraison de carburant là où se trouve le joueur, par exemple en panne sèche) : prix du litre majoré
       * de `surchargeBp` (5000 = +50 %), plus des frais de livraison fixes.
       */
      remoteFuel: z.object({ surchargeBp: int(0, 100_000), fee: int(0, 1_000_000) }).strict().default({ surchargeBp: 5_000, fee: 1_000 }),
      /** Lieux où l'on fait le plein et l'entretien (stations-service). */
      stations: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(20),
      maxVehicles: int(1, 20),
      /** Revente : valeur de départ (pb du prix payé), perte par km (pb), plancher (pb). */
      resale: z.object({ startBp: bp, lossBpPerKm: int(0, 10_000), floorBp: bp }).strict(),
      /** Condition sous laquelle le véhicule refuse de rouler ; risque de panne (pb) par tranche d'entretien dépassé. */
      rules: z.object({ minCondition: int(0, 100), breakdownBpPerOverdue: bp, breakdownDamage: int(1, 100) }).strict(),
    })
    .strict(),
  // Urgence SAMU : appel possible quand la santé est à `callBelowHealth` ou moins ; transfert à l'hôpital, prise en charge de
  // `stayGameHours` heures de jeu, besoins remontés aux valeurs `restore` (jamais abaissés), facture `fee` (moins la part AMU).
  'emergency.samu': z
    .object({
      callBelowHealth: int(1, 100),
      /** Hôpital des urgences par ville (clé = ville) ; `default` sert pour une ville absente de la liste. */
      hospitalByCity: z.record(z.string(), z.string().regex(/^[a-z0-9_]{2,32}$/)),
      stayGameHours: int(1, 72),
      fee: int(0, 10_000_000),
      restore: z.object({ health: int(0, 100), energy: int(0, 100), hunger: int(0, 100), hygiene: int(0, 100), morale: int(0, 100) }).strict(),
    })
    .strict(),
  // Parcours médical : examen, demandes d'analyses (avec leurs résultats selon la maladie), interprétation et ordonnance.
  // Les prix des ordonnances s'ajoutent au `treatment` de la maladie (health.illnesses) : garder leur somme égale.
  'health.workup': z
    .object({
      analyses: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              nameFr: z.string().min(2).max(80),
              nameEn: z.string().min(2).max(80),
              price: int(0, 10_000_000),
              unit: z.string().max(12),
              refFr: z.string().max(48),
              refEn: z.string().max(48),
              // Résultat selon la maladie du patient (clé = id de la maladie, ou « healthy »)
              results: z.record(
                z.string().regex(/^[a-z0-9_]{2,32}$/),
                z.object({ valueFr: z.string().max(48), valueEn: z.string().max(48), flag: z.enum(['normal', 'high', 'low', 'positive', 'negative']) }).strict(),
              ),
            })
            .strict(),
        )
        .max(40),
      byIllness: z.record(
        z.string().regex(/^[a-z0-9_]{2,32}$/),
        z
          .object({
            vitals: z.object({ temp: z.string().max(6), pulse: int(30, 220), bp: z.string().max(8) }).strict(),
            examFr: z.string().max(260),
            examEn: z.string().max(260),
            orders: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(6),
            interpretFr: z.string().max(420),
            interpretEn: z.string().max(420),
            prescription: z
              .array(
                z
                  .object({
                    id: z.string().regex(/^[a-z0-9_]{2,32}$/),
                    nameFr: z.string().min(2).max(80),
                    nameEn: z.string().min(2).max(80),
                    doseFr: z.string().max(90),
                    doseEn: z.string().max(90),
                    price: int(0, 10_000_000),
                  })
                  .strict(),
              )
              .max(8),
          })
          .strict(),
      ),
    })
    .strict(),
  // Famille : chance quotidienne d'une demande, demandes possibles (montant selon la condition de naissance), délai de réponse, effets
  'family.rules': z
    .object({
      dailyRequestBp: bp,
      answerDays: int(1, 30),
      requests: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              amount: z.object({ POOR: int(1), MIDDLE: int(1), RICH: int(1) }).strict(),
              paidRespect: int(0, 100),
              paidMorale: int(-100, 100),
              refusedRespect: int(0, 100),
              refusedMorale: int(0, 100),
            })
            .strict(),
        )
        .min(1)
        .max(20),
      // Coup de dur : la famille aide un peu quand le solde est très bas (chance quotidienne, montant selon la condition)
      helpBelow: int(0, 10_000_000),
      helpChanceBp: z.object({ POOR: bp, MIDDLE: bp, RICH: bp }).strict(),
      helpAmount: z.object({ POOR: int(0), MIDDLE: int(0), RICH: int(0) }).strict(),
    })
    .strict(),
  // Cérémonies organisées par les joueurs : coût par type, respect gagné, don minimum et maximum d'un invité, délai d'organisation
  'ceremony.rules': z
    .object({
      kinds: z.object({ DOT: z.object({ cost: int(0), respect: int(0, 100) }).strict(), BAPTEME: z.object({ cost: int(0), respect: int(0, 100) }).strict(), FUNERAILLES: z.object({ cost: int(0), respect: int(0, 100) }).strict(), ANNIVERSAIRE: z.object({ cost: int(0), respect: int(0, 100) }).strict() }).strict(),
      minGift: int(0),
      maxGift: int(0),
      guestRespect: int(0, 100),
      guestMorale: int(0, 100),
      minDaysAhead: int(0, 30),
      maxDaysAhead: int(1, 90),
      maxPerMonth: int(1, 30),
      /// Lieux où l'on peut organiser une fête (salle de l'hôtel, plage, maquis…)
      venues: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(1).max(40),
    })
    .strict(),
  // Coupures d'électricité et d'eau au logement : chance quotidienne, durée (heures de jeu), effet sur le moral et l'hygiène ;
  // équipements qui protègent (prix)
  'utilities.outages': z
    .object({
      powerDailyBp: bp,
      powerHours: z.tuple([int(1, 72), int(1, 72)]),
      powerMorale: int(0, 100),
      waterDailyBp: bp,
      waterHours: z.tuple([int(1, 72), int(1, 72)]),
      waterHygiene: int(0, 100),
      generatorPrice: int(0),
      solarPrice: int(0),
      tankPrice: int(0),
    })
    .strict(),
  // Événements économiques (les mêmes pour tous les joueurs) : chance par semaine de jeu, effet sur les prix de gros et le transport
  'economy.events': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          weeklyBp: bp,
          wholesaleBp: z.record(z.string().regex(/^[a-z0-9_*]{1,32}$/), int(1_000, 50_000)),
          transportBp: int(1_000, 50_000),
        })
        .strict(),
    )
    .max(20),
  // Voyages entre villes en car : gare de chaque ville, liaisons (prix FCFA, durée en heures de jeu), énergie perdue par heure de route
  'travel.intercity': z
    .object({
      // false : départs fermés, on reste à Lomé (seul le retour vers Lomé reste possible) ; absent des anciens réglages = fermé
      enabled: z.boolean().default(false),
      cities: z.array(z.object({ id: z.string().regex(/^[a-z]{2,16}$/), gare: z.string().regex(/^[a-z0-9_]{2,32}$/), region: z.enum(['MARITIME', 'PLATEAUX', 'CENTRALE', 'KARA', 'SAVANES']) }).strict()).min(1).max(20),
      routes: z.array(z.object({ a: z.string(), b: z.string(), price: int(0, 1_000_000), hours: int(1, 48) }).strict()).max(100),
      energyPerHour: int(0, 20),
    })
    .strict(),
  // Hôtel : catégories de chambres (nombre, prix par nuit), séjour maximal, service en chambre, salles à la journée
  'hotel': z
    .object({
      venueId: z.string().regex(/^[a-z0-9_]{2,32}$/),
      maxNights: int(1, 60),
      rooms: z.array(z.object({ id: z.string().regex(/^[a-z_]{2,24}$/), count: int(0, 1000), nightly: int(0, 10_000_000), comfort: int(0, 100) }).strict()).min(1).max(10),
      roomService: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              emoji: z.string().min(1).max(16),
              nameFr: z.string().min(2).max(64),
              nameEn: z.string().min(2).max(64),
              price: int(0, 1_000_000),
              hunger: int(-100, 100),
              energy: int(-100, 100),
              morale: int(-100, 100),
              health: int(-100, 100),
            })
            .strict(),
        )
        .max(30),
      halls: z.array(z.object({ id: z.string().regex(/^[a-z_]{2,24}$/), capacity: int(1, 10_000), daily: int(0, 100_000_000), respect: int(0, 100) }).strict()).max(10),
      /// Salle louée automatiquement quand une fête est organisée à l'hôtel
      partyHall: z.string().regex(/^[a-z_]{2,24}$/),
    })
    .strict(),
  // Emploi entre joueurs : plafond du salaire brut d'une offre et nombre d'offres ouvertes par entreprise
  'company.playerJobs': z.object({ maxGross: int(), maxOpenOffers: int(1, 20) }).strict(),
  // Plusieurs entreprises, vente et ventes automatiques des salariés : nombre maximal d'entreprises ouvertes par joueur ;
  // prix de vente = bénéfice net d'une séance × saleShifts (+ saleShiftsPerEmployee par salarié actif) ; chaque salarié actif vend seul
  // `employeeSaleBp` du bénéfice d'une séance du patron à chaque séance écoulée (rattrapage plafonné à maxCatchUpShifts).
  'company.portfolio': z.object({ maxCompanies: int(1, 20), saleShifts: int(1, 1000), saleShiftsPerEmployee: int(0, 500), employeeSaleBp: bp, maxCatchUpShifts: int(1, 200) }).strict(),
  // Emplois salariés des employeurs publics (un par métier du catalogue) : salaire brut mensuel par niveau, borné [min, max] et
  // réparti selon le gain par service du métier ; `minShifts` services du métier dans le mois clos pour toucher le salaire entier
  'jobs.public': z
    .object({
      enabled: z.boolean(),
      minShifts: int(0, 200),
      bands: z.object({ DEBROUILLE: z.object({ min: int(), max: int() }).strict(), QUALIFIE: z.object({ min: int(), max: int() }).strict(), DIPLOME: z.object({ min: int(), max: int() }).strict() }).strict(),
    })
    .strict(),
  // Métiers payés À LA TÂCHE (à chaque service) ; tous les autres sont salariés : embauche chez un employeur, salaire mensuel selon les services faits
  'jobs.taskPaid': z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(200),
  // Activités possibles : chiffre d'affaires et charges par séance de travail
  'company.activities': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          nameFr: z.string().min(2).max(64),
          nameEn: z.string().min(2).max(64),
          revenue: int(),
          cost: int(),
          shiftGameHours: int(1, 24),
          energyCost: int(0, 100),
        })
        .strict(),
    )
    .min(1)
    .max(30),
  // Marchés publics (tenders) : secteurs éligibles à la génération automatique, cadence, fourchettes de la génération.
  // Candidature par enchère (prix ET délai proposés par le candidat) : score pondéré prix bas + délai court.
  // `sessionsRange` : nombre de séances de travail nécessaires pour réaliser le projet, tiré indépendamment du
  // prix/délai proposés — connu de tous les candidats avant de candidater.
  'market.tenders': z
    .object({
      sectors: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).min(0).max(60),
      autoGenerate: z.boolean(),
      /** Part (points de base) des marchés générés qui couvrent plusieurs domaines à la fois (catalogue `TENDER_MULTI`). */
      multiSectorChanceBp: bp.default(4_000),
      /** Au moins ce nombre d'heures de jeu entre deux marchés générés automatiquement. */
      cadenceGameHours: int(1, 2000),
      /** Date limite de candidature d'un marché généré automatiquement, en heures de jeu après sa publication. */
      applicationWindowGameHours: int(1, 500),
      slotsRange: z.tuple([int(1, 50), int(1, 50)]),
      budgetRange: z.tuple([int(1), int(1)]),
      maxHoursRange: z.tuple([int(1, 2000), int(1, 2000)]),
      /** Fourchette du nombre de séances de travail nécessaires, tirée par la génération automatique. */
      sessionsRange: z.tuple([int(1, 100), int(1, 100)]),
      /** Pondération prix bas / délai court du score de sélection (points de base, somme = 10 000). */
      scoreWeightsBp: z
        .object({ priceBp: int(0, 10_000), hoursBp: int(0, 10_000) })
        .strict()
        .refine((v) => v.priceBp + v.hoursBp === 10_000),
    })
    .strict()
    .refine((v) => v.slotsRange[0] <= v.slotsRange[1] && v.budgetRange[0] <= v.budgetRange[1] && v.maxHoursRange[0] <= v.maxHoursRange[1] && v.sessionsRange[0] <= v.sessionsRange[1]),
  // Cours du soir et apprentissages : horaires, frais, leçons (questions à choix) et métiers débloqués
  // Études supérieures : bac technique, BTS, licence, master, doctorat par domaine ; conditions d'accès aux métiers
  'study': z
    .object({
      /** Lieu où l'on s'inscrit (le reste des études se suit depuis le téléphone). */
      venueId: z.string().regex(/^[a-z0-9_]{2,32}$/),
      domains: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z_]{2,24}$/),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(80),
              nameEn: z.string().min(2).max(80),
              lessons: z
                .array(
                  z
                    .object({
                      textFr: z.string().max(400),
                      textEn: z.string().max(400),
                      qFr: z.string().max(200),
                      qEn: z.string().max(200),
                      choicesFr: z.array(z.string().max(80)).min(2).max(4),
                      choicesEn: z.array(z.string().max(80)).min(2).max(4),
                      answer: int(0, 3),
                    })
                    .strict(),
                )
                .min(1)
                .max(40),
            })
            .strict(),
        )
        .min(1)
        .max(30),
      /** Séries du bac technique et domaine auquel chacune donne accès. */
      bt: z.array(z.object({ series: z.string().regex(/^[a-z0-9]{1,8}$/), domain: z.string().regex(/^[a-z_]{2,24}$/), nameFr: z.string().max(80), nameEn: z.string().max(80) }).strict()).max(20),
      /** Cursus : nombre d'années, inscription par année (FCFA), séances à suivre par année. */
      cycles: z.object({ BT: cycle, BTS: cycle, LICENCE: cycle, MASTER: cycle, DOCTORAT: cycle }).strict(),
      /** Part minimale de bonnes réponses (points de base) pour réussir l'examen de l'année. */
      minCorrectBp: bp,
      sessionEnergy: int(0, 50),
      sessionHunger: int(0, 50),
      /** Respect gagné à l'obtention de chaque diplôme. */
      respectReward: z.object({ BT: int(0, 50), BTS: int(0, 50), LICENCE: int(0, 50), MASTER: int(0, 50), DOCTORAT: int(0, 50) }).strict(),
      /** Condition d'accès à un métier : diplôme minimal et domaines acceptés. */
      jobReq: z.record(
        z.string().regex(/^[a-z0-9_]{2,32}$/),
        (() => {
          const option = z.object({ min: z.enum(['BAC', 'BT', 'BTS', 'LICENCE', 'MASTER', 'DOCTORAT']), domains: z.array(z.string().regex(/^[a-z_]{2,24}$/)).max(10).optional() }).strict();
          // Options alternatives : un seul des diplômes listés suffit (ex. licence en informatique OU BTS en réseaux)
          return option.extend({ or: z.array(option).max(10).optional() }).strict();
        })(),
      ),
    })
    .strict(),
  /** Conférences publiques : lieu, horaire, une tous les `everyDays` jours, prix d'entrée, retard toléré, effets et sujets. */
  'conference': z
    .object({
      venueId: z.string().regex(/^[a-z0-9_]{2,32}$/),
      startHour: int(0, 22),
      hours: int(1, 4),
      everyDays: int(1, 30),
      offsetDay: int(0, 30),
      fee: int(0, 1_000_000),
      lateMinutes: int(0, 240),
      morale: int(0, 30),
      respect: int(0, 30),
      energy: int(0, 50),
      topics: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              emoji: z.string().min(1).max(8),
              speaker: z.string().min(2).max(80),
              titleFr: z.string().min(2).max(100),
              titleEn: z.string().min(2).max(100),
              textFr: z.string().min(2).max(600),
              textEn: z.string().min(2).max(600),
            })
            .strict(),
        )
        .min(1)
        .max(80),
    })
    .strict(),
  /** Séances de cours : retard toléré (minutes de jeu après le début) pour entrer en classe. */
  'school.class': z.object({ lateMinutes: int(0, 360) }).strict(),
  'school.courses': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{2,32}$/),
          venueId: z.string().regex(/^[a-z0-9_]{2,32}$/),
          emoji: z.string().min(1).max(8),
          nameFr: z.string().min(2).max(100),
          nameEn: z.string().min(2).max(100),
          teacher: z.string().min(2).max(60),
          startHour: int(0, 23),
          hours: int(1, 6),
          fee: int(),
          unlocks: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(10),
          lessons: z
            .array(
              z
                .object({
                  textFr: z.string().max(400),
                  textEn: z.string().max(400),
                  qFr: z.string().max(200),
                  qEn: z.string().max(200),
                  choicesFr: z.array(z.string().max(80)).min(2).max(4),
                  choicesEn: z.array(z.string().max(80)).min(2).max(4),
                  answer: int(0, 3),
                })
                .strict(),
            )
            .min(1)
            .max(30),
        })
        .strict(),
    )
    .max(30),
  // Lieu de travail de chaque métier (il faut s'y rendre pour prendre son service)
  // Métiers qu'on exerce à toute heure, même si leur lieu de départ est fermé (livreur, zém)
  // Travail de nuit : la paie de la séance est majorée (points de base) entre fromHour et toHour
  'work.night': z.object({ fromHour: int(0, 23), toHour: int(0, 23), bonusBp: int(0, 30_000) }).strict(),
  /** Moto d'une séance de zém : location Gozem, versement au propriétaire (moto confiée) et kilomètres parcourus avec sa propre moto. */
  'work.zemBike': z.object({ gozemFee: int(0, 100_000), ownerFee: int(0, 100_000), ownKm: int(1, 200) }).strict(),
  'work.anyHour': z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(50),
  'work.places': z.record(z.string().regex(/^[a-z0-9_]{2,32}$/), z.string().regex(/^[a-z0-9_]{2,32}$/)),
  // Emplacement du logement sur la carte selon son type (quartier).
  'savings': z.object({ dailyBp: int(0, 100), maxBalance: int(0, 1_000_000_000_000) }).strict(),
  'banks': z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z]{2,16}$/),
          name: z.string().min(2).max(40),
          kind: z.enum(['BANK', 'MFI']),
          savingsYearBp: int(0, 2_000),
          minSavings: int(0, 10_000_000),
          minTerm: int(1, 1_000_000_000),
          terms: z.array(z.object({ months: int(1, 120), yearBp: int(0, 3_000) }).strict()).min(1).max(8),
        })
        .strict(),
    )
    .min(1)
    .max(20),
  // Prêt bancaire personnel : plafond fixe, taux annuel simple, durée totale et nombre de mensualités fixes,
  // pénalité de retard (bp/jour, bornée) appliquée si le prélèvement automatique échoue faute de solde.
  'bank.loans': z
    .object({
      capAmount: int(1_000, 1_000_000_000),
      rateBp: int(0, 10_000),
      termDays: int(30, 3_600),
      installmentsCount: int(1, 60),
      lateFeeBpPerDay: int(0, 1_000),
    })
    .strict(),
  'fx.rates': z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().max(1_000_000)),
  // Industrie : usines et zones franches à acheter (grosses fortunes), salariés, investisseurs PNJ qui entrent au capital
  'industry': z
    .object({
      /** Nombre de jours de jeu de bénéfice qui s'accumulent au plus sans encaissement. */
      maxAccrualDays: int(1, 365),
      /** Taxe sur la revente entre joueurs (points de base du prix). */
      transferTaxBp: bp,
      /** Prix de revente demandé au plus ce multiple du prix du catalogue. */
      maxAskMultiple: int(1, 20),
      /**
       * Créer son propre site au lieu d'en racheter un existant : prix en points de base du prix d'achat (moins cher), construction
       * plus longue (démarrage × `startupMultiple`), au plus `maxPerType` sites créés par joueurs pour chaque type.
       */
      build: z.object({ priceBp: int(1_000, 20_000), startupMultiple: int(1, 10), maxPerType: int(0, 500) }).strict().default({ priceBp: 8_000, startupMultiple: 3, maxPerType: 100 }),
      /**
       * Équipements d'un site : forage (l'eau du réseau baisse, mais la pompe consomme de l'électricité) et installation solaire
       * (l'électricité baisse ; très coûteuse). Prix selon la taille du site : part du prix du site, avec un minimum.
       */
      equipment: z
        .object({
          /** Entretien : tous les `serviceEveryDays` jours de jeu, coût `serviceBp` du prix de l'équipement ; en retard, l'efficacité baisse. */
          borehole: z.object({ priceBp: int(0, 10_000), minPrice: int(0, 10_000_000_000), waterSaveBp: int(0, 10_000), pumpPowerBp: int(0, 10_000), serviceEveryDays: int(1, 365), serviceBp: int(0, 10_000), breakdownBp: int(0, 10_000).default(100), repairBp: int(0, 10_000).default(600) }).strict(),
          solar: z.object({ priceBp: int(0, 10_000), minPrice: int(0, 10_000_000_000), powerSaveBp: int(0, 10_000), serviceEveryDays: int(1, 365), serviceBp: int(0, 10_000), breakdownBp: int(0, 10_000).default(50), repairBp: int(0, 10_000).default(400) }).strict(),
        })
        .strict()
        .default({ borehole: { priceBp: 300, minPrice: 4_000_000, waterSaveBp: 8_000, pumpPowerBp: 3_000, serviceEveryDays: 30, serviceBp: 200, breakdownBp: 100, repairBp: 600 }, solar: { priceBp: 1_500, minPrice: 15_000_000, powerSaveBp: 6_000, serviceEveryDays: 60, serviceBp: 150, breakdownBp: 50, repairBp: 400 } }),
      plants: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              /** Usine, zone franche, exploitation agricole (cultures) ou élevage. */
              kind: z.enum(['FACTORY', 'FREE_ZONE', 'FARM', 'LIVESTOCK']),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(60),
              nameEn: z.string().min(2).max(60),
              descFr: z.string().max(240),
              descEn: z.string().max(240),
              districtFr: z.string().max(40),
              districtEn: z.string().max(40),
              /** Nombre d'exemplaires à vendre (une zone franche peut avoir plusieurs parcelles). */
              units: int(1, 50),
              price: int(1, 1_000_000_000_000),
              maxStaff: int(1, 5_000),
              /** Salaire versé par jour de jeu à chaque salarié. */
              wagePerStaff: int(0, 10_000_000),
              /** Chiffre d'affaires par jour de jeu, en points de base du prix, quand le site tourne à pleine capacité. */
              dailyRevenueBp: int(1, 10_000),
              /** Jours de jeu de démarrage (construction, mise en route) avant les premiers intérêts. */
              startupGameDays: int(0, 365).default(7),
            })
            .strict(),
        )
        .max(40),
      /** Aléas : ventes du jour entre min et max de la normale, jours d'incident, charges fixes par jour (points de base du prix). */
      risk: z
        .object({
          swingMinBp: int(0, 30_000),
          swingMaxBp: int(0, 30_000),
          incidentBp: int(0, 10_000),
          fixedCostBp: int(0, 1_000),
          /** Demande du marché par jour (points de base de la production normale) : sous 10000, surproduction et stock invendu. */
          demandMinBp: int(0, 30_000).default(7_000),
          demandMaxBp: int(0, 30_000).default(13_000),
          /** Dépréciation du stock invendu par jour, selon le type de site (produits frais : plus forte). */
          spoilBp: z.object({ FACTORY: int(0, 10_000), FREE_ZONE: int(0, 10_000), FARM: int(0, 10_000), LIVESTOCK: int(0, 10_000) }).strict().default({ FACTORY: 50, FREE_ZONE: 30, FARM: 400, LIVESTOCK: 250 }),
          /** Eau, puis électricité, en part de la production du jour (points de base), selon le type de site. */
          waterBp: z.object({ FACTORY: int(0, 5_000), FREE_ZONE: int(0, 5_000), FARM: int(0, 5_000), LIVESTOCK: int(0, 5_000) }).strict().default({ FACTORY: 150, FREE_ZONE: 100, FARM: 350, LIVESTOCK: 300 }),
          powerBp: z.object({ FACTORY: int(0, 5_000), FREE_ZONE: int(0, 5_000), FARM: int(0, 5_000), LIVESTOCK: int(0, 5_000) }).strict().default({ FACTORY: 450, FREE_ZONE: 300, FARM: 150, LIVESTOCK: 150 }),
        })
        .strict()
        .default({ swingMinBp: 6_000, swingMaxBp: 13_000, incidentBp: 400, fixedCostBp: 4, demandMinBp: 7_000, demandMaxBp: 13_000, spoilBp: { FACTORY: 50, FREE_ZONE: 30, FARM: 400, LIVESTOCK: 250 }, waterBp: { FACTORY: 150, FREE_ZONE: 100, FARM: 350, LIVESTOCK: 300 }, powerBp: { FACTORY: 450, FREE_ZONE: 300, FARM: 150, LIVESTOCK: 150 } }),
      /** Emplois de joueurs dans les sites : postes proposés (salaire brut mensuel plafonné par poste) et offres ouvertes par site. */
      jobs: z
        .object({
          maxOpenOffers: int(1, 20),
          roles: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{2,32}$/), nameFr: z.string().min(2).max(48), nameEn: z.string().min(2).max(48), maxGross: int(1, 100_000_000) }).strict()).min(1).max(12),
        })
        .strict()
        .default({ maxOpenOffers: 3, roles: [{ id: 'ouvrier', nameFr: 'Ouvrier', nameEn: 'Worker', maxGross: 120_000 }] }),
      investors: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(60),
              nameEn: z.string().min(2).max(60),
              bioFr: z.string().max(200),
              bioEn: z.string().max(200),
              /** Ne s'intéresse qu'aux sites au prix d'au moins ce montant. */
              minPrice: int(0, 1_000_000_000_000),
              /** Part maximale du capital qu'il accepte de prendre (points de base). */
              maxShareBp: int(100, 10_000),
              /** Valorisation offerte : multiple du prix du site (points de base, 10000 = le prix), varie chaque jour de ±15 %. */
              offerBp: int(1_000, 50_000),
              /** Rachat de sa part par le propriétaire : majoration sur la valorisation du jour. */
              buybackPremiumBp: int(0, 50_000),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  'invest': z
    .object({
      feeBp: bp,
      maxSharesPerStock: int(1, 1_000_000),
      maxOpenVentures: int(1, 50),
      stocks: z
        .array(z.object({ symbol: z.string().regex(/^[A-Z]{2,8}$/), nameFr: z.string().min(2).max(60), nameEn: z.string().min(2).max(60), sectorFr: z.string().max(40), sectorEn: z.string().max(40), base: int(5, 10_000_000), driftBp: z.number().int().min(-500).max(500), volBp: int(0, 3000) }).strict())
        .max(30),
      options: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              kind: z.enum(['FARM', 'BUSINESS']),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(60),
              nameEn: z.string().min(2).max(60),
              descFr: z.string().max(200),
              descEn: z.string().max(200),
              cost: int(1, 1_000_000_000),
              gameDays: int(1, 365),
              /** Rendement total tiré entre min et max (points de base du montant investi, peut être négatif). */
              minReturnBp: z.number().int().min(-10_000).max(100_000),
              maxReturnBp: z.number().int().min(-10_000).max(100_000),
              /** Probabilité d'échec (sécheresse, panne, vol) : récolte perdue / activité arrêtée en cours de route. */
              failBp: bp,
            })
            .strict(),
        )
        .max(40),
    })
    .strict(),
  // Foncier : zones de terrain à vendre par quarts de lot, prix du m² selon la position, démarches du titre foncier, exploitations
  'land': z
    .object({
      lotM2: int(4, 100_000),
      quarterM2: int(1, 25_000),
      maxM2PerPlayer: int(1, 10_000_000),
      maxPicksPerPurchase: int(1, 100),
      /** Frais de dossier à l'achat (→ Trésor) et droits d'enregistrement à la revente (payés par l'acheteur, → Trésor), en points de base. */
      purchaseFeeBp: bp,
      transferTaxBp: bp,
      /** Prix demandé à la revente au plus égal à ce multiple de la valeur d'achat. */
      maxAskMultiple: int(1, 100),
      price: z
        .object({
          hubX: int(-2_000, 2_000),
          hubZ: int(-2_000, 2_000),
          centerPerM2: int(1, 100_000_000),
          edgePerM2: int(1, 100_000_000),
          halfDistance: int(1, 5_000),
          roads: z.array(z.object({ axis: z.enum(['x', 'z']), at: int(-2_000, 2_000) }).strict()).max(20),
          roadBonusBp: int(0, 50_000),
          roadRange: int(1, 500),
          seaZ: int(-2_000, 2_000),
          seaBonusBp: int(0, 50_000),
          seaRange: int(1, 1_000),
        })
        .strict(),
      zones: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z_]{2,20}$/),
              nameFr: z.string().min(1).max(60),
              nameEn: z.string().min(1).max(60),
              descFr: z.string().max(300),
              descEn: z.string().max(300),
              originX: int(-2_000, 2_000),
              originZ: int(-2_000, 2_000),
              cols: int(1, 100),
              rows: int(1, 100),
              cell: int(2, 40),
              tierBp: int(1_000, 100_000),
              /** Prix du m² imposé (lotissement viabilisé) : remplace le calcul selon la position. */
              fixedPerM2: int(1, 100_000_000).optional(),
              /** Marge de sol autour de la grille (0 en pleine ville, 6 par défaut) et enseigne d'entrée (oui par défaut). */
              margin: int(0, 20).optional(),
              sign: z.boolean().optional(),
              /** Zone en mer (parcelles marines de prestige) : dessinée sur l'eau, sans route d'accès ; distincte des cases de publicité (`sea.plots`). */
              water: z.boolean().optional(),
              /** Zone à extension : rangées ouvertes au départ ; les suivantes s'ouvrent au fil des achats, `reserveRows` (2 par défaut) toujours libres d'avance. */
              startRows: int(1, 100).optional(),
              reserveRows: int(1, 20).optional(),
            })
            .strict(),
        )
        .max(60),
      /** Démarches du titre foncier (dans l'ordre) : frais au m² avec minimum, durée en heures de jeu. */
      steps: z
        .object({
          SURVEYED: z.object({ feePerM2: int(), minFee: int(), gameHours: int(0, 24 * 365) }).strict(),
          OPINION: z.object({ feePerM2: int(), minFee: int(), gameHours: int(0, 24 * 365) }).strict(),
          TITLED: z.object({ feePerM2: int(), minFee: int(), gameHours: int(0, 24 * 365) }).strict(),
        })
        .strict(),
      /** Exploitations d'un terrain titré : maison (coût fixe) ou activité (coût au m², revenu quotidien en % du capital sur `lifeGameDays`). */
      uses: z
        .array(
          z
            .object({
              id: z.string().regex(/^(house|biz)_[a-z_]{2,24}$/),
              kind: z.enum(['HOUSE', 'BUSINESS']),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(1).max(60),
              nameEn: z.string().min(1).max(60),
              /** Logement construit (HOUSE seulement) : classe de logement (loyer, factures, intérieur). */
              model: z.enum(['ENTRER_COUCHER', 'CHAMBRE_SALON', 'VILLA']).optional(),
              /** Modèle dessiné sur la carte (HOUSE seulement) ; voir front/src/game/houses.ts. */
              style: z.enum(HOUSE_STYLES).optional(),
              /** Description courte du modèle (HOUSE seulement). */
              descFr: z.string().max(160).optional(),
              descEn: z.string().max(160).optional(),
              minM2: int(1, 1_000_000),
              cost: int(0, 1_000_000_000),
              costPerM2: int(0, 100_000_000),
              buildGameDays: int(0, 365),
              dailyYieldBp: int(0, 10_000),
              lifeGameDays: int(0, 3_650),
            })
            .strict(),
        )
        .max(40),
    })
    .strict(),
  // Durées de location proposées pour les parcelles, en semaines (prix : produit AD_PLOT, par case et par semaine)
  // Location des cases de pub : prix par case et par période de `days` jours, durées proposées en nombre de périodes
  'ad.boards': z.object({ count: int(1, 100) }).strict(),
  // Rotation : `max` annonces rotatives en même temps (au-delà, plus de réservation rotative en libre-service) ;
  // `panels` derniers numéros de panneaux jamais vendus en fixe aux joueurs, pour que la rotation garde toujours des panneaux
  'ad.rotation': z.object({ max: int(1, 50), panels: int(0, 100) }).strict(),
  'ad.plots.period': z.object({ days: int(1, 90), counts: z.array(int(1, 36)).min(1).max(6) }).strict(),
  // Autres espaces de pub loués comme la mer (même prix) : grand mur à l'est de la ville, cases flottantes sur les lagunes
  'ad.zones': z
    .array(z.object({ id: z.string().regex(/^[a-z_]{2,20}$/), slot: int(-20, -3), cols: int(1, 200), rows: int(1, 200), cell: int(1, 20), originX: int(-500, 500), originZ: int(-500, 500), maxSide: int(1, 20) }).strict())
    .max(10),
  'sea.plots': z.object({ cols: int(4, 200), rows: int(2, 100), cell: int(1, 20), originX: int(-500, 500), originZ: int(0, 500), maxSide: int(1, 20), days: int(1, 365) }).strict(),
  'venues.hours': z.record(z.string().regex(/^[a-z0-9_]{2,32}$/), z.tuple([int(0, 24), int(0, 24)])),
  'port.goods': z
    .object({
      swingBp: bp,
      /** Écart du cours de rachat à distance sous le prix d'achat du jour (commerce depuis le téléphone). */
      remoteSpreadBp: bp.default(800),
      /** Marge maximale d'un trajet sur le coût de revient (achat + douane) : plafonne le prix de revente. */
      maxMarginBp: bp.default(3800),
      /** Obsolète (gardé pour les réglages déjà enregistrés) : la limite de vente varie désormais chaque jour, voir ci-dessous. */
      dailyDepthBp: bp.default(2500),
      /** Vente par jour de jeu et par marchandise : tirée chaque jour entre `dailyMinSell` et `dailyMaxSell` unités. */
      dailyMinSell: int(1, 1000).default(5),
      dailyMaxSell: int(1, 1000).default(25),
      /** Un bénéfice de vente supérieur à ce montant est inscrit au journal d'audit (surveillance). */
      alertProfit: int().default(300_000),
      goods: z
        .array(
          z
            .object({
              id: z.string().regex(/^[a-z0-9_]{2,32}$/),
              emoji: z.string().min(1).max(8),
              nameFr: z.string().min(2).max(60),
              nameEn: z.string().min(2).max(60),
              kind: z.enum(['IMPORT', 'EXPORT', 'LOCAL', 'CAR']),
              buyAt: z.string().regex(/^[a-z0-9_]{2,32}$/),
              sellAt: z.string().regex(/^[a-z0-9_]{2,32}$/),
              buyPrice: int(25, 100_000_000),
              sellPrice: int(25, 100_000_000),
              /** Droits de douane à l'achat (import) ou taxe à la vente (export), en points de base. */
              taxBp: bp,
              maxQty: int(1, 1000),
              /** Effet sur le respect à l'achat (posséder une voiture, par exemple). */
              respect: int(0, 50),
            })
            .strict(),
        )
        .max(80),
    })
    .strict(),
  /** Emplacements du lieu de marque des partenaires (formules Argent et Or), choisis par l'admin dans une liste. */
  'partners.spots': z
    .array(z.object({ id: z.string().regex(/^[a-z0-9_]{2,32}$/), nameFr: z.string().min(2).max(80), nameEn: z.string().min(2).max(80), x: int(-300, 300), z: int(-1100, 60) }).strict())
    .max(200),
  /**
   * Services d'un bâtiment de marque selon son modèle : activités achetables sur place (soins, repas, repos…, effets sur les
   * jauges), appli du téléphone ouverte, et métiers que l'on peut y exercer. Le lieu de jeu est créé automatiquement pour chaque
   * partenaire qui tient un emplacement.
   */
  'partners.services': z.record(
    z.enum(['tower', 'agency', 'restaurant', 'shop', 'station', 'transport', 'clinic', 'hotel']),
    z
      .object({
        emoji: z.string().min(1).max(8),
        app: z.string().regex(/^[a-z]{2,16}$/).nullable(),
        jobs: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/)).max(12),
        activities: z
          .array(
            z
              .object({
                emoji: z.string().min(1).max(8),
                nameFr: z.string().min(1).max(64),
                nameEn: z.string().min(1).max(64),
                price: int(0, 10_000_000),
                hunger: int(-100, 100),
                energy: int(-100, 100),
                hygiene: int(-100, 100),
                health: int(-100, 100),
                morale: int(-100, 100),
                respect: int(-100, 100),
              })
              .strict(),
          )
          .max(8),
      })
      .strict(),
  ),
  'partners.tiers': z
    .object(
      Object.fromEntries(
        (['BRONZE', 'SILVER', 'GOLD'] as const).map((k) => [
          k,
          z.object({ boards: int(0, 100), rotating: int(0, 100).default(0), brandPlace: z.boolean(), jobs: int(0, 100), eventsPerMonth: int(0, 100), monthlyPrice: int(0, 100_000_000), defaultMonths: int(1, 60).default(12), minMonths: int(1, 60).default(1), maxMonths: int(1, 60).default(36) }).strict(),
        ]),
      ) as Record<'BRONZE' | 'SILVER' | 'GOLD', z.ZodObject<{ boards: z.ZodNumber; rotating: z.ZodDefault<z.ZodNumber>; brandPlace: z.ZodBoolean; jobs: z.ZodNumber; eventsPerMonth: z.ZodNumber; monthlyPrice: z.ZodNumber; defaultMonths: z.ZodDefault<z.ZodNumber>; minMonths: z.ZodDefault<z.ZodNumber>; maxMonths: z.ZodDefault<z.ZodNumber> }>>,
    )
    .strict(),
  // Contact des annonceurs affiché sur la page d'accueil, renvoyé par GET /boards/offer (vide = masqué)
  'partners.showcase': z.object({ show: z.boolean() }).strict(),
  'account.deletedRetention': z.object({ days: int(30, 3650) }).strict(),
  'partners.contact': z
    .object({ email: z.union([z.literal(''), z.string().email().max(120)]), whatsapp: z.string().regex(/^(\+[1-9]\d{7,14})?$/) })
    .strict(),
  'home.position': z.object({ VILLA: point, CHAMBRE_SALON: point, ENTRER_COUCHER: point }).strict(),
  // CAR : sa propre voiture (il faut en posséder une) ; le tarif est le carburant
  'transport.modes': z.object({ WALK: transportMode, ZEM: transportMode, WORO: transportMode, BUS: transportMode, CAR: transportMode.optional(), MOTO: transportMode.optional() }).strict(),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

const BASE_PARTNER_SPOTS: { id: string; nameFr: string; nameEn: string; x: number; z: number }[] = [
    // Quartier d'affaires Ouest : 4 grands emplacements Or en bord de boulevard, 24 emplacements Argent sur les rues
    { id: 'affaires_or_1', nameFr: 'Quartier d’affaires Ouest – Or 1, boulevard de Nyékonakpoè', nameEn: 'West business district – Gold 1, Nyékonakpoè boulevard', x: -180, z: -41 },
    { id: 'affaires_or_2', nameFr: 'Quartier d’affaires Ouest – Or 2, boulevard de Nyékonakpoè', nameEn: 'West business district – Gold 2, Nyékonakpoè boulevard', x: -225, z: -41 },
    { id: 'affaires_or_3', nameFr: 'Quartier d’affaires Ouest – Or 3, boulevard d’Adidogomé', nameEn: 'West business district – Gold 3, Adidogomé boulevard', x: -180, z: -121 },
    { id: 'affaires_or_4', nameFr: 'Quartier d’affaires Ouest – Or 4, boulevard d’Adidogomé', nameEn: 'West business district – Gold 4, Adidogomé boulevard', x: -225, z: -121 },
    { id: 'affaires_argent_1', nameFr: 'Quartier d’affaires Ouest – Argent 1, rue du milieu', nameEn: 'West business district – Silver 1, middle street', x: -235, z: -81 },
    { id: 'affaires_argent_2', nameFr: 'Quartier d’affaires Ouest – Argent 2, rue du milieu', nameEn: 'West business district – Silver 2, middle street', x: -215, z: -81 },
    { id: 'affaires_argent_3', nameFr: 'Quartier d’affaires Ouest – Argent 3, rue du milieu', nameEn: 'West business district – Silver 3, middle street', x: -185, z: -81 },
    { id: 'affaires_argent_4', nameFr: 'Quartier d’affaires Ouest – Argent 4, rue du milieu', nameEn: 'West business district – Silver 4, middle street', x: -165, z: -81 },
    { id: 'affaires_argent_5', nameFr: 'Quartier d’affaires Ouest – Argent 5, rue des agences prolongée', nameEn: 'West business district – Silver 5, agencies street extension', x: -235, z: -161 },
    { id: 'affaires_argent_6', nameFr: 'Quartier d’affaires Ouest – Argent 6, rue des agences prolongée', nameEn: 'West business district – Silver 6, agencies street extension', x: -215, z: -161 },
    { id: 'affaires_argent_7', nameFr: 'Quartier d’affaires Ouest – Argent 7, rue des agences prolongée', nameEn: 'West business district – Silver 7, agencies street extension', x: -185, z: -161 },
    { id: 'affaires_argent_8', nameFr: 'Quartier d’affaires Ouest – Argent 8, rue des agences prolongée', nameEn: 'West business district – Silver 8, agencies street extension', x: -165, z: -161 },
    { id: 'affaires_argent_9', nameFr: 'Quartier d’affaires Ouest – Argent 9, rue du nord', nameEn: 'West business district – Silver 9, north street', x: -235, z: -201 },
    { id: 'affaires_argent_10', nameFr: 'Quartier d’affaires Ouest – Argent 10, rue du nord', nameEn: 'West business district – Silver 10, north street', x: -215, z: -201 },
    { id: 'affaires_argent_11', nameFr: 'Quartier d’affaires Ouest – Argent 11, rue du nord', nameEn: 'West business district – Silver 11, north street', x: -185, z: -201 },
    { id: 'affaires_argent_12', nameFr: 'Quartier d’affaires Ouest – Argent 12, rue du nord', nameEn: 'West business district – Silver 12, north street', x: -165, z: -201 },
    { id: 'affaires_argent_13', nameFr: 'Quartier d’affaires Ouest – Argent 13, côté plage', nameEn: 'West business district – Silver 13, beach side', x: -185, z: -17 },
    { id: 'affaires_argent_14', nameFr: 'Quartier d’affaires Ouest – Argent 14, côté plage', nameEn: 'West business district – Silver 14, beach side', x: -230, z: -17 },
    { id: 'affaires_argent_15', nameFr: 'Quartier d’affaires Ouest – Argent 15, boulevard de Nyékonakpoè', nameEn: 'West business district – Silver 15, Nyékonakpoè boulevard', x: -275, z: -41 },
    { id: 'affaires_argent_16', nameFr: 'Quartier d’affaires Ouest – Argent 16, rue du milieu', nameEn: 'West business district – Silver 16, middle street', x: -275, z: -81 },
    { id: 'affaires_argent_17', nameFr: 'Quartier d’affaires Ouest – Argent 17, boulevard d’Adidogomé', nameEn: 'West business district – Silver 17, Adidogomé boulevard', x: -275, z: -121 },
    { id: 'affaires_argent_18', nameFr: 'Quartier d’affaires Ouest – Argent 18, rue des agences prolongée', nameEn: 'West business district – Silver 18, agencies street extension', x: -275, z: -161 },
    { id: 'affaires_argent_19', nameFr: 'Quartier d’affaires Ouest – Argent 19, rue du nord', nameEn: 'West business district – Silver 19, north street', x: -275, z: -201 },
    { id: 'affaires_argent_20', nameFr: 'Quartier d’affaires Ouest – Argent 20, rue du haut', nameEn: 'West business district – Silver 20, top street', x: -275, z: -241 },
    { id: 'affaires_argent_21', nameFr: 'Quartier d’affaires Ouest – Argent 21, rue du haut', nameEn: 'West business district – Silver 21, top street', x: -235, z: -241 },
    { id: 'affaires_argent_22', nameFr: 'Quartier d’affaires Ouest – Argent 22, rue du haut', nameEn: 'West business district – Silver 22, top street', x: -215, z: -241 },
    { id: 'affaires_argent_23', nameFr: 'Quartier d’affaires Ouest – Argent 23, rue du haut', nameEn: 'West business district – Silver 23, top street', x: -185, z: -241 },
    { id: 'affaires_argent_24', nameFr: 'Quartier d’affaires Ouest – Argent 24, rue du haut', nameEn: 'West business district – Silver 24, top street', x: -165, z: -241 },
    { id: 'eyadema_est_cnss', nameFr: 'Boulevard Eyadéma Est – face à la CNSS', nameEn: 'Eyadéma Boulevard East – opposite the CNSS', x: 24, z: -172 },
    { id: 'eyadema_est_gta', nameFr: 'Boulevard Eyadéma Est – avant le rond-point GTA', nameEn: 'Eyadéma Boulevard East – before the GTA roundabout', x: 24, z: -192 },
    { id: 'lome2_otr', nameFr: 'Lomé II – derrière l’OTR', nameEn: 'Lomé II – behind the OTR', x: 50, z: -170 },
    // Autour du rond-point GTA
    { id: 'gta_sud_est', nameFr: 'Rond-point GTA – entre Yas et la Présidence', nameEn: 'GTA roundabout – between Yas and the Presidency', x: 45, z: -205 },
    { id: 'gta_nord_est', nameFr: 'Rond-point GTA – au nord, côté est du boulevard', nameEn: 'GTA roundabout – north, east of the boulevard', x: 12, z: -260 },
    { id: 'gta_sud_ouest', nameFr: 'Rond-point GTA – au sud-ouest, avenue de la Chance', nameEn: 'GTA roundabout – south-west, Avenue de la Chance', x: -30, z: -212 },
    { id: 'gta_eyadema_ouest', nameFr: 'Rond-point GTA – boulevard Eyadéma, côté ouest', nameEn: 'GTA roundabout – Eyadéma Boulevard, west side', x: -28, z: -186 },
    { id: 'lome2_presidence', nameFr: 'Lomé II – près de la Présidence', nameEn: 'Lomé II – near the Presidency', x: 48, z: -188 },
    // Bords de la RN1 entre Agoè et Davié : grands espaces verts, loin des lieux et des zones de terrain
    { id: 'rn1_ouest_km8', nameFr: 'RN1 vers Tsévié – côté ouest, km 8 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 8 past GTA', x: -16, z: -505 },
    { id: 'rn1_est_km8', nameFr: 'RN1 vers Tsévié – côté est, km 8 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 8 past GTA', x: 16, z: -505 },
    { id: 'rn1_ouest_km9', nameFr: 'RN1 vers Tsévié – côté ouest, km 9 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 9 past GTA', x: -16, z: -540 },
    { id: 'rn1_est_km9', nameFr: 'RN1 vers Tsévié – côté est, km 9 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 9 past GTA', x: 16, z: -540 },
    { id: 'rn1_ouest_km10', nameFr: 'RN1 vers Tsévié – côté ouest, km 10 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 10 past GTA', x: -16, z: -575 },
    { id: 'rn1_est_km10', nameFr: 'RN1 vers Tsévié – côté est, km 10 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 10 past GTA', x: 16, z: -575 },
    { id: 'rn1_ouest_km11', nameFr: 'RN1 vers Tsévié – côté ouest, km 11 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 11 past GTA', x: -16, z: -610 },
    { id: 'rn1_est_km11', nameFr: 'RN1 vers Tsévié – côté est, km 11 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 11 past GTA', x: 16, z: -610 },
    { id: 'rn1_ouest_km12', nameFr: 'RN1 vers Tsévié – côté ouest, km 12 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 12 past GTA', x: -16, z: -645 },
    { id: 'rn1_ouest_km13', nameFr: 'RN1 vers Tsévié – côté ouest, km 13 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 13 past GTA', x: -16, z: -680 },
    { id: 'rn1_ouest_km14', nameFr: 'RN1 vers Tsévié – côté ouest, km 14 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 14 past GTA', x: -16, z: -715 },
    { id: 'rn1_est_km14', nameFr: 'RN1 vers Tsévié – côté est, km 14 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 14 past GTA', x: 16, z: -715 },
    { id: 'rn1_ouest_km15', nameFr: 'RN1 vers Tsévié – côté ouest, km 15 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 15 past GTA', x: -16, z: -750 },
    { id: 'rn1_est_km15', nameFr: 'RN1 vers Tsévié – côté est, km 15 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 15 past GTA', x: 16, z: -750 },
    { id: 'rn1_ouest_km16', nameFr: 'RN1 vers Tsévié – côté ouest, km 16 après le GTA', nameEn: 'N1 towards Tsévié – west side, km 16 past GTA', x: -16, z: -785 },
    { id: 'rn1_est_km16', nameFr: 'RN1 vers Tsévié – côté est, km 16 après le GTA', nameEn: 'N1 towards Tsévié – east side, km 16 past GTA', x: 16, z: -785 },
];

/**
 * Quartier d'affaires Ouest : chaque îlot entre deux rues compte deux rangées d'emplacements, des Or (grands) et des Argent
 * (plus petits) côte à côte ; on ajoute ici tout ce qui tient et ne recouvre pas un emplacement déjà défini.
 * Les identifiants restent stables (affaires_or_N, affaires_argent_N) : un partenaire déjà placé n'est jamais déplacé.
 */
function moreBusinessSpots(base: { id: string; x: number; z: number }[]): { id: string; nameFr: string; nameEn: string; x: number; z: number }[] {
  const out: { id: string; nameFr: string; nameEn: string; x: number; z: number }[] = [];
  const roadsZ = [14, -30, -70, -110, -150, -190, -230];
  // Colonnes entre les avenues x = -290, -250, -200 et la limite est du quartier : [bord ouest, bord est, composition]
  const columns: { name: string; w0: number; w1: number; cells: ('or' | 'argent')[] }[] = [
    { name: 'avenue ouest', w0: -286.5, w1: -253.5, cells: ['argent', 'argent'] },
    { name: 'avenue du milieu', w0: -246.5, w1: -203.5, cells: ['or', 'argent'] },
    { name: 'îlot est', w0: -196.5, w1: -143, cells: ['or', 'argent', 'argent'] },
  ];
  const SIZE = { or: { w: 21, d: 15 }, argent: { w: 14, d: 12 } };
  let nOr = base.filter((s) => s.id.startsWith('affaires_or_')).length;
  let nArg = base.filter((s) => s.id.startsWith('affaires_argent_')).length;
  // Lieux posés dans le quartier (emprise par défaut d'un lieu : ±12 m de large, 12 m derrière, 26 m devant) : aucun espace dessus.
  // À garder en phase avec les coordonnées de seed.ts.
  const lots = [{ x: -159, z: -42 }, { x: -148, z: -122 }].map((v) => ({ x0: v.x - 12, x1: v.x + 12, z0: v.z - 12, z1: v.z + 26 }));
  const onLot = (x: number, z: number, w: number, d: number) => lots.some((l) => x + w / 2 > l.x0 - 1.5 && x - w / 2 < l.x1 + 1.5 && z + d / 2 > l.z0 - 1.5 && z - d / 2 < l.z1 + 1.5);
  const taken = [...base];
  // Deux emplacements ne se recouvrent jamais (dimensions réelles de chacun, plus 1 m de passage)
  const clash = (x: number, z: number, w: number, d: number) =>
    taken.some((o) => {
      const sz = o.id.includes('_or_') ? SIZE.or : SIZE.argent;
      return Math.abs(o.x - x) < (w + sz.w) / 2 + 1 && Math.abs(o.z - z) < (d + sz.d) / 2 + 1;
    });
  for (let i = 0; i < roadsZ.length - 1; i++) {
    const zn = roadsZ[i]!;
    const zs = roadsZ[i + 1]!;
    const rows = Math.floor((zn - zs - 7) / 13.5);
    for (let r = 0; r < rows; r++) {
      const z = Math.round(zn - 3.5 - 7.5 - r * ((zn - zs - 7 - 15) / Math.max(1, rows - 1 || 1)) - (rows === 1 ? ((zn - zs - 7 - 15) / 2) : 0));
      for (const col of columns) {
        // Largeur totale des cases de la rangée, puis répartition régulière
        const ws = col.cells.map((c) => SIZE[c].w);
        const gap = (col.w1 - col.w0 - ws.reduce((a, b) => a + b, 0)) / (col.cells.length + 1);
        if (gap < 1) continue;
        let x0 = col.w0 + gap;
        col.cells.forEach((c, k) => {
          const x = Math.round(x0 + ws[k]! / 2);
          x0 += ws[k]! + gap;
          if (clash(x, z, SIZE[c].w, SIZE[c].d)) return;
          const n = c === 'or' ? ++nOr : ++nArg;
          const id = c === 'or' ? `affaires_or_${n}` : `affaires_argent_${n}`;
          if (onLot(x, z, SIZE[c].w, SIZE[c].d)) return; // le numéro reste réservé : les autres identifiants ne changent pas
          const label = c === 'or' ? 'Or' : 'Argent';
          out.push({ id, nameFr: `Quartier d’affaires Ouest – ${label} ${n}, ${col.name}`, nameEn: `West business district – ${c === 'or' ? 'Gold' : 'Silver'} ${n}, ${col.name === 'avenue ouest' ? 'west avenue' : col.name === 'avenue du milieu' ? 'middle avenue' : 'east block'}`, x, z });
          taken.push({ id, x, z });
        });
      }
    }
  }
  return out;
}

/**
 * Trois grands emplacements Or alignés dans l'espace libre de l'est de la ville (vérifié libre de routes, de lieux et de terrains ;
 * les deux autres, qui empiétaient sur la zone Baguida-Est, sont à Lomé II). Les identifiants restent ceux d'origine.
 */
const EAST_GOLD_SPOTS = [189, 171, 153].map((zAbs, i) => ({
  id: `est_or_${i + 3}`,
  nameFr: `Est de la ville – Or ${i + 1}, grand espace libre`,
  nameEn: `East of the city – Gold ${i + 1}, large open plot`,
  x: 176,
  z: -zAbs,
}));

/** Deux grands emplacements Or à l'est de l'OTR (Lomé II), dans l'espace libre entre les terrains et les rues. */
const LOME2_GOLD_SPOTS = [170, 152].map((zAbs, i) => ({
  id: `lome2_or_${i + 1}`,
  nameFr: `Lomé II – Or ${i + 1}, à l’est de l’OTR`,
  nameEn: `Lomé II – Gold ${i + 1}, east of the OTR`,
  x: 82,
  z: -zAbs,
}));

/** Douze petits emplacements Bronze, en grille à l'ouest de la colonne Or de l'est de la ville (vérifié libre de routes, de lieux et de terrains). */
const EAST_BRONZE_SPOTS = [124, 138, 152].flatMap((x, c) =>
  [-190, -177, -164, -151].map((z, r) => {
    const n = c * 4 + r + 1;
    return { id: `est_bronze_${n}`, nameFr: `Est de la ville – Bronze ${n}, petit emplacement`, nameEn: `East of the city – Bronze ${n}, small plot`, x, z };
  }),
);

/** Petits emplacements Bronze (10 × 9 m) qui complètent le quartier d'affaires Ouest (dont le bloc nord, entre la rue du haut et la route d'Adidogomé prolongée), là où ni Or ni Argent ne tiennent (vérifiés libres de routes, de lieux, de terrains et des autres espaces). */
const BUSINESS_BRONZE_SPOTS = ([
  [-168, -9],
  [-156, -9],
  [-151, -81],
  [-168, -93],
  [-168, -135],
  [-135, -158],
  [-151, -161],
  [-137, -169],
  [-151, -201],
  [-139, -201],
  [-137, -212],
  [-278, -253],
  [-266, -253],
  [-238, -253],
  [-226, -253],
  [-214, -253],
  [-188, -253],
  [-176, -253],
  [-164, -253],
  [-152, -253],
  [-278, -264],
  [-266, -264],
  [-238, -264],
  [-226, -264],
  [-214, -264],
  [-188, -264],
  [-176, -264],
  [-164, -264],
  [-152, -264],
  [-278, -275],
  [-266, -275],
  [-238, -275],
  [-226, -275],
  [-214, -275],
  [-188, -275],
  [-176, -275],
  [-164, -275],
  [-152, -275]
] as [number, number][]).map(([x, z], i) => ({
  id: `affaires_bronze_${i + 1}`,
  nameFr: `Quartier d’affaires Ouest – Bronze ${i + 1}, petit emplacement`,
  nameEn: `West business district – Bronze ${i + 1}, small plot`,
  x,
  z,
}));

/** Activité vendue dans un bâtiment de marque : prix et effets (les jauges non citées ne bougent pas). */
const svc = (emoji: string, nameFr: string, nameEn: string, price: number, fx: Partial<Record<'hunger' | 'energy' | 'hygiene' | 'health' | 'morale' | 'respect', number>> = {}) => ({
  emoji, nameFr, nameEn, price, hunger: 0, energy: 0, hygiene: 0, health: 0, morale: 0, respect: 0, ...fx,
});

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'game.clock': { epochRealMs: Date.UTC(2026, 0, 1), secondsPerGameDay: 3600 },
  'food.meal': { minHunger: 20, energyFloor: 70 },
  'work.maxJobs': 3,
  'needs.decay': { perGameHour: { hunger: 2, energy: 2, hygiene: 1, morale: 1 }, maxDecayGameHours: 12, healthLossWhenStarving: 2, offlineAfterGameHours: 3, offlineFloor: 25 },
  'start.capital': { RICH: 1_500_000, MIDDLE: 150_000, POOR: 75_000 },
  'start.housing': { RICH: 'VILLA', MIDDLE: 'CHAMBRE_SALON', POOR: 'ENTRER_COUCHER' },
  'rent.monthly': { VILLA: 250_000, CHAMBRE_SALON: 25_000, ENTRER_COUCHER: 8_000 },
  // Prix d'achat du logement (≈ 10 ans de loyer) : une fois propriétaire, plus de loyer
  // Électricité (CEET) : bas de fourchette, consommation modeste (ampoules, ventilateur, télé ; climatisation mesurée pour la villa)
  // Tarifs INDICATIFS (tranches CEET), à vérifier avant lancement
  'bills.power': {
    subscription: { VILLA: 2_500, CHAMBRE_SALON: 1_000, ENTRER_COUCHER: 500 },
    baseKwh: { VILLA: 90, CHAMBRE_SALON: 35, ENTRER_COUCHER: 15 },
    applianceKwh: { frigo: 35, fridge: 35, freezer: 45, meuble_tele: 12, ventilo: 15, lampadaire: 4, aquarium: 8 },
    cookKwh: 1,
    solarBp: 6_000,
    tranches: [
      { upToKwh: 40, price: 73 },
      { upToKwh: 150, price: 111 },
      { upToKwh: null, price: 130 },
    ],
  },
  // Tarifs INDICATIFS (tranches TdE), à vérifier avant lancement
  'bills.water': {
    subscription: { VILLA: 2_000, CHAMBRE_SALON: 1_000, ENTRER_COUCHER: 500 },
    baseLitres: { VILLA: 9_000, CHAMBRE_SALON: 4_000, ENTRER_COUCHER: 2_000 },
    showerLitres: 80,
    cookLitres: 10,
    tranches: [
      { upToM3: 10, price: 300 },
      { upToM3: 30, price: 450 },
      { upToM3: null, price: 600 },
    ],
  },
  'bills.monthly': { ELEC: { VILLA: 25_000, CHAMBRE_SALON: 5_000, ENTRER_COUCHER: 2_000 }, WATER: { VILLA: 15_000, CHAMBRE_SALON: 4_000, ENTRER_COUCHER: 2_000 }, WIFI: 15_000 },
  'housing.price': { VILLA: 30_000_000, CHAMBRE_SALON: 3_000_000, ENTRER_COUCHER: 1_000_000 },
  'destiny.weights': { POOR: 55, MIDDLE: 38, RICH: 7 },
  'destiny.bonusRespect': 10,
  'start.quota': { RICH: { maxShareBp: 1000, minSlots: 2 }, MIDDLE: { maxShareBp: 6000, minSlots: 5 } },
  'transfer.fee': { rateBp: 100, min: 25, max: 5_000 },
  'transfer.limits': { minAccountAgeHours: 24, dailySendMax: 50_000, dailyReceiveMax: 100_000 },
  amu: { coverageBp: 8000, voluntaryMonthly: 5_000, hospitals: ['chu', 'chu_campus', 'chr_commune', 'hopital_dogta', 'chr_kpalime', 'chr_sokode', 'chu_kara', 'chr_dapaong'] },
  'freezer': { price: 150_000, capacity: 24, discountBp: 2_000 },
  'home.furniture': {
    resaleBp: 6_000,
    slots: { ENTRER_COUCHER: 16, CHAMBRE_SALON: 30, VILLA: 40 },
    starterValueBp: 2_500,
    giftValueBp: 2_500,
    storageMax: 60,
    starters: {
      ENTRER_COUCHER: [
        { itemId: 'matelas', x: -1.9, z: -1.5, rot: 0 },
        { itemId: 'chaise', x: 0.6, z: -2.3, rot: 0 },
        { itemId: 'bidons', x: -0.3, z: -3.2, rot: 0 },
        { itemId: 'valise', x: 1.3, z: -3.2, rot: 0 },
        { itemId: 'rechaud', x: 2.65, z: -3.15, rot: 0 },
        { itemId: 'seau', x: 3, z: -0.8, rot: 0 },
        { itemId: 'ventilo', x: 2.5, z: 1.5, rot: 0 },
      ],
      CHAMBRE_SALON: [
        { itemId: 'lit_double', x: -3.5, z: -2.5, rot: 0 },
        { itemId: 'chevet', x: -1.5, z: -3, rot: 0 },
        { itemId: 'armoire', x: -0.4, z: -4, rot: 0 },
        { itemId: 'table_manger', x: 2.2, z: 0.9, rot: 0 },
        { itemId: 'chaise', x: 1, z: 0.9, rot: 1 },
        { itemId: 'chaise', x: 3.4, z: 0.9, rot: 3 },
        { itemId: 'meuble_tele', x: 3.5, z: -3.9, rot: 0 },
        { itemId: 'fauteuil', x: 3.5, z: -1.8, rot: 2 },
        { itemId: 'cuisiniere', x: 3, z: 3.9, rot: 2 },
        { itemId: 'bidons', x: 1.6, z: -2.8, rot: 0 },
        { itemId: 'seau', x: 4.8, z: 3, rot: 0 },
        { itemId: 'plante', x: 5, z: -2, rot: 0 },
        { itemId: 'ventilo', x: -4.7, z: 0.5, rot: 0 },
      ],
    },
    rooms: { ENTRER_COUCHER: { w: 7, d: 7 }, CHAMBRE_SALON: { w: 11, d: 9 }, VILLA: { w: 22, d: 16 } },
    standing: { comfortable: 40, luxurious: 120 },
    items: [
      { id: 'canape', model: 'sofa', emoji: '🛋️', nameFr: 'Canapé 3 places', nameEn: 'Three-seat sofa', price: 180000, w: 2.2, d: 0.95, comfort: 12 },
      { id: 'fauteuil', model: 'armchair', emoji: '💺', nameFr: 'Fauteuil', nameEn: 'Armchair', price: 75000, w: 0.9, d: 0.9, comfort: 5 },
      { id: 'lit_double', model: 'bed', emoji: '🛏️', nameFr: 'Lit double', nameEn: 'Double bed', price: 220000, w: 1.9, d: 2.1, comfort: 14, fixed: true },
      { id: 'meuble_tele', model: 'tv', emoji: '📺', nameFr: 'Télé et meuble', nameEn: 'TV and stand', price: 150000, w: 1.6, d: 0.5, comfort: 10 },
      { id: 'bibliotheque', model: 'bookcase', emoji: '📚', nameFr: 'Bibliothèque', nameEn: 'Bookcase', price: 95000, w: 1.2, d: 0.4, comfort: 8 },
      { id: 'armoire', model: 'wardrobe', emoji: '🚪', nameFr: 'Armoire', nameEn: 'Wardrobe', price: 120000, w: 1.4, d: 0.6, comfort: 7 },
      { id: 'table_manger', model: 'dining', emoji: '🍽️', nameFr: 'Table à manger', nameEn: 'Dining table', price: 110000, w: 1.6, d: 0.9, comfort: 9 },
      { id: 'bureau', model: 'desk', emoji: '🖥️', nameFr: 'Bureau', nameEn: 'Desk', price: 85000, w: 1.3, d: 0.65, comfort: 6 },
      { id: 'plante', model: 'plant', emoji: '🪴', nameFr: 'Plante verte', nameEn: 'Green plant', price: 15000, w: 0.5, d: 0.5, comfort: 2 },
      { id: 'lampadaire', model: 'lamp', emoji: '💡', nameFr: 'Lampadaire', nameEn: 'Floor lamp', price: 25000, w: 0.4, d: 0.4, comfort: 3 },
      { id: 'tapis', model: 'rug', emoji: '🟫', nameFr: 'Tapis', nameEn: 'Rug', price: 45000, w: 2.0, d: 1.4, comfort: 4, flat: true },
      { id: 'frigo', model: 'fridge', emoji: '🧊', nameFr: 'Réfrigérateur inox', nameEn: 'Steel fridge', price: 280000, w: 0.7, d: 0.7, comfort: 10 },
      { id: 'aquarium', model: 'aquarium', emoji: '🐠', nameFr: 'Aquarium', nameEn: 'Aquarium', price: 140000, w: 1.2, d: 0.4, comfort: 8 },
      { id: 'matelas', model: 'mattress', emoji: '🛌', nameFr: 'Matelas mousse', nameEn: 'Foam mattress', price: 45000, w: 2.05, d: 3.05, comfort: 4, fixed: true },
      { id: 'chaise', model: 'chair', emoji: '🪑', nameFr: 'Chaise', nameEn: 'Chair', price: 8000, w: 0.5, d: 0.5, comfort: 1 },
      { id: 'rechaud', model: 'stove', emoji: '🔥', nameFr: 'Réchaud sur caisse', nameEn: 'Stove on a crate', price: 30000, w: 1.1, d: 0.6, comfort: 2 },
      { id: 'cuisiniere', model: 'kitchen', emoji: '🍳', nameFr: 'Cuisinière équipée', nameEn: 'Fitted kitchen', price: 350000, w: 2.4, d: 0.8, comfort: 10 },
      { id: 'valise', model: 'trunk', emoji: '🧳', nameFr: 'Valise', nameEn: 'Suitcase', price: 20000, w: 1.1, d: 0.45, comfort: 1 },
      { id: 'bidons', model: 'jerrycans', emoji: '🛢️', nameFr: 'Bidons d’eau', nameEn: 'Water jerrycans', price: 10000, w: 0.9, d: 0.45, comfort: 0 },
      { id: 'seau', model: 'bucket', emoji: '🪣', nameFr: 'Seau d’eau', nameEn: 'Water bucket', price: 6000, w: 0.7, d: 0.7, comfort: 0 },
      { id: 'ventilo', model: 'fan', emoji: '🌀', nameFr: 'Ventilateur sur pied', nameEn: 'Standing fan', price: 22000, w: 0.5, d: 0.5, comfort: 3 },
      { id: 'chevet', model: 'bedside', emoji: '🕯️', nameFr: 'Table de chevet', nameEn: 'Bedside table', price: 35000, w: 0.8, d: 0.7, comfort: 4 },
      { id: 'piano', model: 'piano', emoji: '🎹', nameFr: 'Piano droit', nameEn: 'Upright piano', price: 900000, w: 1.5, d: 0.7, comfort: 30 },
      { id: 'billard', model: 'billiard', emoji: '🎱', nameFr: 'Table de billard', nameEn: 'Pool table', price: 1200000, w: 2.4, d: 1.3, comfort: 35 },
    ],
  },
  'kitchen': {
    items: [
      { id: 'igname', emoji: '🍠', nameFr: 'Igname (2 tubercules)', nameEn: 'Yam (2 tubers)', price: 600, pack: 2, shelfDays: 20, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'farine_mais', emoji: '🌽', nameFr: 'Farine de maïs (1 kg)', nameEn: 'Maize flour (1 kg)', price: 500, pack: 2, shelfDays: 60, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'riz', emoji: '🍚', nameFr: 'Riz (1 kg)', nameEn: 'Rice (1 kg)', price: 700, pack: 2, shelfDays: 120, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'haricots', emoji: '🫘', nameFr: 'Haricots (1 kg)', nameEn: 'Beans (1 kg)', price: 800, pack: 2, shelfDays: 120, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'arachide', emoji: '🥜', nameFr: 'Pâte d’arachide', nameEn: 'Peanut paste', price: 700, pack: 2, shelfDays: 45, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'gombo', emoji: '🥬', nameFr: 'Gombo (un tas)', nameEn: 'Okra (a heap)', price: 300, pack: 2, shelfDays: 4, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'tomate', emoji: '🍅', nameFr: 'Tomates (un tas)', nameEn: 'Tomatoes (a heap)', price: 300, pack: 3, shelfDays: 5, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'oignon', emoji: '🧅', nameFr: 'Oignons (un tas)', nameEn: 'Onions (a heap)', price: 250, pack: 3, shelfDays: 14, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'piment', emoji: '🌶️', nameFr: 'Piment', nameEn: 'Chilli pepper', price: 150, pack: 3, shelfDays: 10, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'poisson', emoji: '🐟', nameFr: 'Poisson fumé', nameEn: 'Smoked fish', price: 900, pack: 2, shelfDays: 6, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'viande', emoji: '🥩', nameFr: 'Viande de bœuf', nameEn: 'Beef', price: 1800, pack: 2, shelfDays: 3, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'oeufs', emoji: '🥚', nameFr: 'Plateau d’œufs', nameEn: 'Tray of eggs', price: 1500, pack: 6, shelfDays: 12, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'pain', emoji: '🥖', nameFr: 'Baguette', nameEn: 'Baguette', price: 150, pack: 2, shelfDays: 2, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'the', emoji: '🍵', nameFr: 'Thé et sucre', nameEn: 'Tea and sugar', price: 400, pack: 4, shelfDays: 180, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'huile', emoji: '🫗', nameFr: 'Huile de palme (1 L)', nameEn: 'Palm oil (1 L)', price: 1000, pack: 4, shelfDays: 90, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'epices', emoji: '🧂', nameFr: 'Sel et cubes', nameEn: 'Salt and stock cubes', price: 200, pack: 6, shelfDays: 180, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe', 'supermarche'] },
      { id: 'gaz', emoji: '🔵', nameFr: 'Recharge de gaz SODIGAZ (20 cuissons)', nameEn: 'SODIGAZ gas refill (20 meals)', price: 6000, pack: 20, shelfDays: 0, venues: ['station_oryx', 'station_total', 'station_lome2', 'station_boulevard', 'supermarche'] },
      { id: 'charbon', emoji: '⚫', nameFr: 'Sac de charbon (8 cuissons)', nameEn: 'Bag of charcoal (8 meals)', price: 1600, pack: 8, shelfDays: 0, venues: ['marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe'] },
    ],
    appliances: [
      { id: 'fridge', kind: 'FRIDGE', emoji: '🧊', nameFr: 'Réfrigérateur', nameEn: 'Fridge', descFr: 'Garde les aliments frais bien plus longtemps et conserve les restes.', descEn: 'Keeps fresh food much longer and stores leftovers.', price: 120000, venues: ['supermarche', 'marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe'] },
      { id: 'stove_charcoal', kind: 'STOVE', fuel: 'CHARCOAL', fuelItem: 'charbon', emoji: '🔥', nameFr: 'Fourneau à charbon', nameEn: 'Charcoal stove', descFr: 'Pas cher, il consomme du charbon à chaque cuisson.', descEn: 'Cheap, burns charcoal at each meal.', price: 8000, venues: ['supermarche', 'marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe'] },
      { id: 'stove_gas', kind: 'STOVE', fuel: 'GAS', fuelItem: 'gaz', emoji: '🍳', nameFr: 'Réchaud à gaz', nameEn: 'Gas stove', descFr: 'Rapide et propre, il consomme du gaz (bouteille à recharger à la station).', descEn: 'Fast and clean, uses gas (refill at the station).', price: 45000, venues: ['supermarche', 'marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe'] },
      { id: 'stove_electric', kind: 'STOVE', fuel: 'ELECTRIC', emoji: '⚡', nameFr: 'Réchaud électrique', nameEn: 'Electric hob', descFr: 'Aucun combustible à acheter : chaque cuisson compte sur ta facture d’électricité du mois.', descEn: 'No fuel to buy: each meal counts on your monthly electricity bill.', price: 35000, venues: ['supermarche', 'marche_assigame', 'akodessewa', 'marche_agoe', 'marche_hedzranawoe'] },
    ],
    recipes: [
      { id: 'r_koliko', foodId: 'koliko', portions: 4, effort: 5, items: [{ id: 'igname', qty: 1 }, { id: 'huile', qty: 1 }, { id: 'piment', qty: 1 }, { id: 'epices', qty: 1 }] },
      { id: 'r_akoume', foodId: 'akoume', portions: 4, effort: 8, items: [{ id: 'farine_mais', qty: 1 }, { id: 'gombo', qty: 2 }, { id: 'poisson', qty: 1 }, { id: 'huile', qty: 1 }, { id: 'piment', qty: 1 }, { id: 'epices', qty: 1 }] },
      { id: 'r_ablo', foodId: 'ablo', portions: 4, effort: 10, items: [{ id: 'farine_mais', qty: 2 }, { id: 'poisson', qty: 1 }, { id: 'tomate', qty: 1 }, { id: 'oignon', qty: 1 }, { id: 'huile', qty: 1 }, { id: 'epices', qty: 1 }] },
      { id: 'r_ayimolou', foodId: 'ayimolou', portions: 4, effort: 8, items: [{ id: 'riz', qty: 1 }, { id: 'haricots', qty: 1 }, { id: 'huile', qty: 1 }, { id: 'tomate', qty: 1 }, { id: 'oignon', qty: 1 }, { id: 'epices', qty: 1 }] },
      { id: 'r_fufu', foodId: 'fufu', portions: 4, effort: 12, items: [{ id: 'igname', qty: 2 }, { id: 'arachide', qty: 1 }, { id: 'poisson', qty: 1 }, { id: 'tomate', qty: 1 }, { id: 'piment', qty: 1 }, { id: 'epices', qty: 1 }] },
      { id: 'r_the_omelette', foodId: 'the_omelette', portions: 3, effort: 3, items: [{ id: 'oeufs', qty: 1 }, { id: 'pain', qty: 2 }, { id: 'the', qty: 1 }, { id: 'huile', qty: 1 }] },
      { id: 'r_the_pain', foodId: 'the_pain', portions: 2, effort: 2, items: [{ id: 'pain', qty: 2 }, { id: 'the', qty: 1 }] },
    ],
    fridgeShelfBp: 30_000,
    leftoverDays: 1,
    leftoverFridgeDays: 4,
    homeMoraleBonus: 3,
    electricFee: 60,
    maxLeftovers: 12,
  },
  'activities.oncePerDay': [],
  'action.music': { moraleGain: 8, energyGain: 5, cooldownGameHours: 0 },
  'action.tv': { moraleGain: 6, energyGain: 3, cooldownGameHours: 0 },
  'action.read': { moraleGain: 4, energyGain: -1, cooldownGameHours: 0 },
  // Retard : 1 % par jour de retard sur le loyer et sur les factures d'électricité et d'eau
  'rent.rules': { lateFeeBpPerDay: 100, evictAfterMonths: 3, depositMonths: 2, nagRespect: 2, nagMorale: 3, evictRespect: 15, evictMorale: 20 },
  'action.rest': { energyGain: 35, cooldownGameHours: 0, napGameHours: 2 },
  'action.sleep': { fromHour: 20, wakeHour: 6, minGameHours: 3, maxGameHours: 4, energyGain: 90, moraleGain: 4 },
  'action.wash': { price: 100, hygieneGain: 45 },
  'payroll.rates': { smig: 52_500, cnssEmployeeBp: 400, cnssEmployerBp: 1750, amuEmployeeBp: 500, amuEmployerBp: 500, irppBrackets: [] },
  'tax.vatBp': 1800,
  'company.cfe': { feeEI: 25_400, feeSociety: 28_250, feeSocietyNonEcowas: 33_250, delayGameHours: 4 },
  'company.capitalMin': { EI: 0, SARL: 1_000_000, SA: 10_000_000 },
  'company.contributions': { cnssTnsBp: 2150, amuTnsMonthly: 10_000, otrBp: 500, penaltyBpPerMonth: 1000, graceDays: 15, unregisteredFine: 25_000, maxEmployees: 8 },
  'chat': { maxLength: 280, minIntervalSeconds: 3, historySize: 50, autoHideReports: 3, minAccountAgeHours: 1, blockedWords: [], presenceMax: 40, groupsMax: 10, groupMembersMax: 20 },
  'tontine': { minContribution: 1_000, maxContribution: 200_000, periods: [7, 30], minMembers: 3, maxMembers: 12, missRespect: 15, missMorale: 10, maxActive: 3, maxDefaultsToJoin: 2, minAccountAgeHours: 24 },
  // Prix de gros INDICATIFS (Lomé), à vérifier sur le terrain avant lancement
  'market.goods': [
    { id: 'gari', emoji: '🥣', nameFr: 'Gari (1 kg)', nameEn: 'Gari (1 kg)', wholesale: 700, maxMarkupBp: 20_000, effects: { hunger: 20 } },
    { id: 'mais', emoji: '🌽', nameFr: 'Maïs en grains (1 kg)', nameEn: 'Maize grain (1 kg)', wholesale: 350, maxMarkupBp: 20_000, effects: { hunger: 15 } },
    { id: 'tomates', emoji: '🍅', nameFr: 'Tas de tomates', nameEn: 'Heap of tomatoes', wholesale: 300, maxMarkupBp: 20_000, effects: { hunger: 5, health: 2 } },
    { id: 'huile', emoji: '🫗', nameFr: 'Huile rouge (1 L)', nameEn: 'Red palm oil (1 L)', wholesale: 1_200, maxMarkupBp: 20_000, effects: { hunger: 8 } },
    { id: 'eau_pack', emoji: '💧', nameFr: 'Paquet de 30 sachets d’eau', nameEn: 'Pack of 30 water sachets', wholesale: 900, maxMarkupBp: 20_000, effects: { health: 5, hunger: 2 } },
    { id: 'savon', emoji: '🧼', nameFr: 'Savon de ménage', nameEn: 'Household soap', wholesale: 300, maxMarkupBp: 20_000, effects: { hygiene: 20 } },
    { id: 'credit', emoji: '📶', nameFr: 'Crédit de communication (1 000)', nameEn: 'Phone credit (1,000)', wholesale: 950, maxMarkupBp: 12_000, effects: { morale: 3 } },
    { id: 'pagne_wax', emoji: '🧵', nameFr: 'Pagne wax (6 yards)', nameEn: 'Wax print (6 yards)', wholesale: 12_000, maxMarkupBp: 20_000, effects: { respect: 3, morale: 4 } },
    { id: 'tenue', emoji: '👘', nameFr: 'Tenue cousue (boubou)', nameEn: 'Tailored outfit (boubou)', wholesale: 15_000, maxMarkupBp: 20_000, effects: { respect: 6, morale: 5 } },
    { id: 'telephone', emoji: '📱', nameFr: 'Téléphone simple', nameEn: 'Basic phone', wholesale: 9_000, maxMarkupBp: 18_000, effects: { morale: 10, respect: 2 } },
  ],
  'market.rules': {
    venues: ['marche_assigame', 'marche_agoe', 'marche_hedzranawoe', 'marche_kpalime', 'marche_sokode', 'marche_kara', 'marche_dapaong'],
    weeklyRent: 3_500,
    maxWeeks: 8,
    taxBp: 200,
    maxStock: 500,
    maxBuy: 50,
    ranks: [{ id: 'revendeuse', minSales: 0 }, { id: 'grossiste', minSales: 2_000_000 }, { id: 'nana_benz', minSales: 20_000_000 }],
  },
  'clothes.items': DEFAULT_GARMENTS,
  'clothes.rules': { venues: ['mode_assigame', 'mode_nyekonakpoe', 'mode_be', 'mode_adidogome'], weeklyRent: 7_000, maxWeeks: 8, taxBp: 200, maxStock: 200, maxBuy: 5, wholesaleBp: 6_000, maxPriceBp: 15_000, closeBuybackBp: 5_000, closeRentRefundBp: 5_000, npcVisitsPerDay: 2, npcMaxCatchUpDays: 3 },
  // Prix INDICATIFS des soins (secteur public, Lomé), à vérifier avant lancement
  'health.illnesses': [
    { id: 'paludisme', nameFr: 'Paludisme', nameEn: 'Malaria', weight: 50, dailyHealth: 8, dailyEnergy: 10, treatment: 3_000, selfHealDays: 0 },
    { id: 'typhoide', nameFr: 'Fièvre typhoïde', nameEn: 'Typhoid fever', weight: 12, dailyHealth: 7, dailyEnergy: 6, treatment: 7_500, selfHealDays: 0 },
    { id: 'diarrhee', nameFr: 'Diarrhée', nameEn: 'Diarrhoea', weight: 20, dailyHealth: 5, dailyEnergy: 5, treatment: 1_000, selfHealDays: 4 },
    { id: 'grippe', nameFr: 'Grippe', nameEn: 'Flu', weight: 18, dailyHealth: 3, dailyEnergy: 6, treatment: 1_500, selfHealDays: 5 },
  ],
  'health.rules': { dailyRiskBp: 250, dirtyBelow: 30, dirtyMultiplierBp: 20_000, weakBelow: 40, weakMultiplierBp: 15_000, consultPrice: 2_500, healOnTreat: 30, maxCatchUpDays: 7 },
  'vehicles.catalog': {
    models: [
      { id: 'moto_sanya', kind: 'MOTO', nameFr: 'Moto Sanya 125', nameEn: 'Sanya 125 motorbike', emoji: '🛵', descFr: 'Moto chinoise d’entrée de gamme, économique et facile à réparer.', descEn: 'Entry-level Chinese motorbike, cheap to run and easy to repair.', price: 450_000, tankL: 8, mlPerKm: 25, serviceEveryKm: 800, serviceCost: 12_000, repairCost: 35_000, seats: 2 },
      { id: 'moto_haojue', kind: 'MOTO', nameFr: 'Haojue 125', nameEn: 'Haojue 125', emoji: '🏍️', descFr: 'La moto des zémidjans : robuste, sobre, pièces partout.', descEn: 'The zémidjan workhorse: tough, thrifty, parts everywhere.', price: 600_000, tankL: 10, mlPerKm: 28, serviceEveryKm: 1_000, serviceCost: 15_000, repairCost: 45_000, seats: 2 },
      { id: 'moto_yamaha', kind: 'MOTO', nameFr: 'Yamaha Crux 110', nameEn: 'Yamaha Crux 110', emoji: '🏍️', descFr: 'Fiabilité japonaise, entretien espacé mais pièces plus chères.', descEn: 'Japanese reliability, longer service intervals but pricier parts.', price: 850_000, tankL: 11, mlPerKm: 22, serviceEveryKm: 1_500, serviceCost: 20_000, repairCost: 70_000, seats: 2 },
      { id: 'moto_tvs', kind: 'MOTO', nameFr: 'TVS Apache 150', nameEn: 'TVS Apache 150', emoji: '🏍️', descFr: 'Moto sportive : rapide mais plus gourmande.', descEn: 'Sporty bike: fast but thirstier.', price: 1_100_000, tankL: 12, mlPerKm: 35, serviceEveryKm: 1_200, serviceCost: 25_000, repairCost: 90_000, seats: 2 },
      { id: 'car_corolla', kind: 'CAR', nameFr: 'Toyota Corolla (occasion)', nameEn: 'Toyota Corolla (used)', emoji: '🚗', descFr: 'La berline d’occasion importée d’Europe, courante à Lomé.', descEn: 'The used saloon imported from Europe, common in Lomé.', price: 3_500_000, tankL: 50, mlPerKm: 80, serviceEveryKm: 3_000, serviceCost: 45_000, repairCost: 250_000, seats: 5 },
      { id: 'car_yaris', kind: 'CAR', nameFr: 'Toyota Yaris', nameEn: 'Toyota Yaris', emoji: '🚙', descFr: 'Citadine sobre, facile à garer dans les rues de Lomé.', descEn: 'Thrifty city car, easy to park in Lomé streets.', price: 5_500_000, tankL: 42, mlPerKm: 60, serviceEveryKm: 4_000, serviceCost: 55_000, repairCost: 300_000, seats: 5 },
      { id: 'car_hyundai', kind: 'CAR', nameFr: 'Hyundai Tucson', nameEn: 'Hyundai Tucson', emoji: '🚙', descFr: 'SUV confortable pour les routes du pays.', descEn: 'Comfortable SUV for the country’s roads.', price: 9_500_000, tankL: 58, mlPerKm: 95, serviceEveryKm: 5_000, serviceCost: 85_000, repairCost: 450_000, seats: 5 },
      { id: 'car_rav4', kind: 'CAR', nameFr: 'Toyota RAV4', nameEn: 'Toyota RAV4', emoji: '🚙', descFr: 'SUV réputé solide, très recherché à la revente.', descEn: 'Famously solid SUV, in high demand on resale.', price: 12_000_000, tankL: 55, mlPerKm: 90, serviceEveryKm: 5_000, serviceCost: 95_000, repairCost: 500_000, seats: 5 },
      { id: 'car_hilux', kind: 'CAR', nameFr: 'Pick-up Toyota Hilux', nameEn: 'Toyota Hilux pick-up', emoji: '🛻', descFr: 'Pick-up costaud pour le travail et les pistes ; boit beaucoup.', descEn: 'Tough pick-up for work and dirt roads; drinks a lot.', price: 16_000_000, tankL: 80, mlPerKm: 120, serviceEveryKm: 5_000, serviceCost: 120_000, repairCost: 650_000, seats: 5 },
    ],
    fuelPricePerL: 600,
    remoteFuel: { surchargeBp: 5_000, fee: 1_000 },
    stations: ['station_oryx', 'station_total', 'station_boulevard', 'station_lome2'],
    maxVehicles: 3,
    resale: { startBp: 8_500, lossBpPerKm: 4, floorBp: 2_500 },
    rules: { minCondition: 25, breakdownBpPerOverdue: 2_500, breakdownDamage: 35 },
  },
  'emergency.samu': {
    callBelowHealth: 30,
    hospitalByCity: { default: 'hopital_dogta', lome: 'hopital_dogta', kpalime: 'chr_kpalime', sokode: 'chr_sokode', kara: 'chu_kara', dapaong: 'chr_dapaong' },
    stayGameHours: 3,
    fee: 15_000,
    restore: { health: 80, energy: 80, hunger: 75, hygiene: 70, morale: 70 },
  },
  'health.workup': {
    analyses: [
      { id: 'tdr_palu', nameFr: 'Test de diagnostic rapide du paludisme (TDR)', nameEn: 'Malaria rapid diagnostic test (RDT)', price: 1_500, unit: '', refFr: 'Négatif', refEn: 'Negative', results: { paludisme: { valueFr: 'Positif', valueEn: 'Positive', flag: 'positive' }, typhoide: { valueFr: 'Négatif', valueEn: 'Negative', flag: 'negative' }, diarrhee: { valueFr: 'Négatif', valueEn: 'Negative', flag: 'negative' }, grippe: { valueFr: 'Négatif', valueEn: 'Negative', flag: 'negative' }, healthy: { valueFr: 'Négatif', valueEn: 'Negative', flag: 'negative' } } },
      { id: 'goutte_epaisse', nameFr: 'Goutte épaisse (parasites du sang)', nameEn: 'Thick blood film (blood parasites)', price: 1_200, unit: '/µL', refFr: '0', refEn: '0', results: { paludisme: { valueFr: '8 400', valueEn: '8,400', flag: 'positive' }, typhoide: { valueFr: '0', valueEn: '0', flag: 'negative' }, diarrhee: { valueFr: '0', valueEn: '0', flag: 'negative' }, grippe: { valueFr: '0', valueEn: '0', flag: 'negative' }, healthy: { valueFr: '0', valueEn: '0', flag: 'negative' } } },
      { id: 'nfs', nameFr: 'Numération formule sanguine (hémoglobine)', nameEn: 'Full blood count (haemoglobin)', price: 2_500, unit: 'g/dL', refFr: '12 – 16', refEn: '12 – 16', results: { paludisme: { valueFr: '9,8', valueEn: '9.8', flag: 'low' }, typhoide: { valueFr: '11,2', valueEn: '11.2', flag: 'low' }, diarrhee: { valueFr: '13,1', valueEn: '13.1', flag: 'normal' }, grippe: { valueFr: '13,4', valueEn: '13.4', flag: 'normal' }, healthy: { valueFr: '13,6', valueEn: '13.6', flag: 'normal' } } },
      { id: 'widal', nameFr: 'Sérodiagnostic de Widal (typhoïde)', nameEn: 'Widal test (typhoid)', price: 3_000, unit: '', refFr: 'Titre O < 1/80', refEn: 'O titre < 1/80', results: { paludisme: { valueFr: '1/20', valueEn: '1/20', flag: 'normal' }, typhoide: { valueFr: '1/320', valueEn: '1/320', flag: 'high' }, diarrhee: { valueFr: '1/20', valueEn: '1/20', flag: 'normal' }, grippe: { valueFr: '1/20', valueEn: '1/20', flag: 'normal' }, healthy: { valueFr: '1/20', valueEn: '1/20', flag: 'normal' } } },
      { id: 'coproculture', nameFr: 'Coproculture (analyse des selles)', nameEn: 'Stool culture', price: 3_500, unit: '', refFr: 'Aucun germe pathogène', refEn: 'No pathogenic germ', results: { paludisme: { valueFr: 'Aucun germe', valueEn: 'No germ', flag: 'negative' }, typhoide: { valueFr: 'Aucun germe', valueEn: 'No germ', flag: 'negative' }, diarrhee: { valueFr: 'E. coli entéropathogène', valueEn: 'Enteropathogenic E. coli', flag: 'positive' }, grippe: { valueFr: 'Aucun germe', valueEn: 'No germ', flag: 'negative' }, healthy: { valueFr: 'Aucun germe', valueEn: 'No germ', flag: 'negative' } } },
      { id: 'crp', nameFr: 'Protéine C-réactive (CRP)', nameEn: 'C-reactive protein (CRP)', price: 2_500, unit: 'mg/L', refFr: '< 5', refEn: '< 5', results: { paludisme: { valueFr: '38', valueEn: '38', flag: 'high' }, typhoide: { valueFr: '62', valueEn: '62', flag: 'high' }, diarrhee: { valueFr: '9', valueEn: '9', flag: 'high' }, grippe: { valueFr: '24', valueEn: '24', flag: 'high' }, healthy: { valueFr: '2', valueEn: '2', flag: 'normal' } } },
    ],
    byIllness: {
      healthy: {
        vitals: { temp: '36,8', pulse: 72, bp: '12/8' },
        examFr: 'Examen clinique sans anomalie : température normale, pouls régulier, tension normale.',
        examEn: 'Normal clinical examination: normal temperature, regular pulse, normal blood pressure.',
        orders: ['nfs'],
        interpretFr: 'Bilan normal : aucune maladie détectée. Continue à bien manger, dormir et te laver pour rester en forme.',
        interpretEn: 'Normal results: no illness detected. Keep eating well, sleeping and washing to stay healthy.',
        prescription: [],
      },
      paludisme: {
        vitals: { temp: '39,2', pulse: 104, bp: '11/7' },
        examFr: 'Fièvre élevée avec frissons, maux de tête et courbatures ; rate sensible à la palpation.',
        examEn: 'High fever with chills, headache and body aches; spleen tender on palpation.',
        orders: ['tdr_palu', 'goutte_epaisse', 'nfs'],
        interpretFr: 'Le test rapide et la goutte épaisse sont positifs : paludisme à Plasmodium falciparum, avec anémie modérée (hémoglobine basse). Traitement antipaludique de 3 jours et repos.',
        interpretEn: 'The rapid test and the blood film are positive: Plasmodium falciparum malaria with moderate anaemia (low haemoglobin). 3-day antimalarial treatment and rest.',
        prescription: [
          { id: 'cta', nameFr: 'Artéméther-luméfantrine (CTA)', nameEn: 'Artemether-lumefantrine (ACT)', doseFr: '1 comprimé matin et soir pendant 3 jours', doseEn: '1 tablet morning and evening for 3 days', price: 2_200 },
          { id: 'paracetamol', nameFr: 'Paracétamol 500 mg', nameEn: 'Paracetamol 500 mg', doseFr: '2 comprimés 3 fois par jour si fièvre, 3 jours', doseEn: '2 tablets 3 times a day if fever, 3 days', price: 500 },
          { id: 'fer', nameFr: 'Fer et acide folique', nameEn: 'Iron and folic acid', doseFr: '1 comprimé par jour pendant 14 jours', doseEn: '1 tablet a day for 14 days', price: 300 },
        ],
      },
      typhoide: {
        vitals: { temp: '39,6', pulse: 88, bp: '11/6' },
        examFr: 'Fièvre en plateau depuis plusieurs jours, douleurs abdominales, langue chargée, grande fatigue.',
        examEn: 'Sustained fever for several days, abdominal pain, coated tongue, great fatigue.',
        orders: ['widal', 'nfs', 'crp'],
        interpretFr: 'Titre de Widal élevé (1/320) avec syndrome inflammatoire : fièvre typhoïde. Antibiotique 7 jours, boire beaucoup, se laver les mains et boire de l’eau sûre.',
        interpretEn: 'High Widal titre (1/320) with inflammation: typhoid fever. 7-day antibiotic, drink plenty, wash your hands and drink safe water.',
        prescription: [
          { id: 'cipro', nameFr: 'Ciprofloxacine 500 mg', nameEn: 'Ciprofloxacin 500 mg', doseFr: '1 comprimé matin et soir pendant 7 jours', doseEn: '1 tablet morning and evening for 7 days', price: 5_200 },
          { id: 'paracetamol', nameFr: 'Paracétamol 500 mg', nameEn: 'Paracetamol 500 mg', doseFr: '2 comprimés 3 fois par jour si fièvre', doseEn: '2 tablets 3 times a day if fever', price: 800 },
          { id: 'sro', nameFr: 'Sels de réhydratation orale (SRO)', nameEn: 'Oral rehydration salts (ORS)', doseFr: '1 sachet dans 1 litre d’eau, à boire dans la journée', doseEn: '1 sachet in 1 litre of water, drink during the day', price: 1_500 },
        ],
      },
      diarrhee: {
        vitals: { temp: '37,6', pulse: 92, bp: '10/6' },
        examFr: 'Selles liquides répétées, crampes abdominales, déshydratation légère (bouche sèche, pli cutané).',
        examEn: 'Repeated watery stools, abdominal cramps, mild dehydration (dry mouth, skin fold).',
        orders: ['coproculture', 'crp'],
        interpretFr: 'La coproculture isole E. coli entéropathogène : gastro-entérite bactérienne. Réhydratation, zinc et alimentation légère ; pas d’antibiotique nécessaire ici.',
        interpretEn: 'The stool culture isolates enteropathogenic E. coli: bacterial gastroenteritis. Rehydration, zinc and light food; no antibiotic needed here.',
        prescription: [
          { id: 'sro', nameFr: 'Sels de réhydratation orale (SRO)', nameEn: 'Oral rehydration salts (ORS)', doseFr: '1 sachet dans 1 litre d’eau après chaque selle liquide', doseEn: '1 sachet in 1 litre of water after each watery stool', price: 600 },
          { id: 'zinc', nameFr: 'Zinc 20 mg', nameEn: 'Zinc 20 mg', doseFr: '1 comprimé par jour pendant 5 jours', doseEn: '1 tablet a day for 5 days', price: 400 },
        ],
      },
      grippe: {
        vitals: { temp: '38,5', pulse: 90, bp: '11/7' },
        examFr: 'Courbatures, toux sèche, nez qui coule, gorge irritée, fièvre modérée.',
        examEn: 'Body aches, dry cough, runny nose, sore throat, moderate fever.',
        orders: ['crp', 'nfs'],
        interpretFr: 'CRP modérément élevée et hémoglobine normale : syndrome grippal d’origine virale. Pas d’antibiotique : repos, boissons chaudes et paracétamol.',
        interpretEn: 'Moderately raised CRP and normal haemoglobin: viral flu-like illness. No antibiotic: rest, hot drinks and paracetamol.',
        prescription: [
          { id: 'paracetamol', nameFr: 'Paracétamol 500 mg', nameEn: 'Paracetamol 500 mg', doseFr: '2 comprimés 3 fois par jour si fièvre ou douleur', doseEn: '2 tablets 3 times a day if fever or pain', price: 700 },
          { id: 'vitc', nameFr: 'Vitamine C 500 mg', nameEn: 'Vitamin C 500 mg', doseFr: '1 comprimé par jour pendant 5 jours', doseEn: '1 tablet a day for 5 days', price: 500 },
          { id: 'sirop', nameFr: 'Sirop contre la toux', nameEn: 'Cough syrup', doseFr: '1 cuillère 3 fois par jour pendant 4 jours', doseEn: '1 spoon 3 times a day for 4 days', price: 300 },
        ],
      },
    },
  },
  'family.rules': {
    dailyRequestBp: 400,
    answerDays: 3,
    requests: [
      { id: 'cousin_village', amount: { POOR: 2_000, MIDDLE: 5_000, RICH: 20_000 }, paidRespect: 4, paidMorale: 2, refusedRespect: 5, refusedMorale: 4 },
      { id: 'scolarite', amount: { POOR: 5_000, MIDDLE: 15_000, RICH: 50_000 }, paidRespect: 6, paidMorale: 4, refusedRespect: 6, refusedMorale: 6 },
      { id: 'tante_malade', amount: { POOR: 3_000, MIDDLE: 10_000, RICH: 30_000 }, paidRespect: 5, paidMorale: 3, refusedRespect: 7, refusedMorale: 8 },
      { id: 'funerailles_famille', amount: { POOR: 5_000, MIDDLE: 20_000, RICH: 75_000 }, paidRespect: 10, paidMorale: 2, refusedRespect: 12, refusedMorale: 6 },
      { id: 'mariage_cousine', amount: { POOR: 3_000, MIDDLE: 10_000, RICH: 40_000 }, paidRespect: 6, paidMorale: 5, refusedRespect: 5, refusedMorale: 3 },
    ],
    helpBelow: 2_000,
    helpChanceBp: { POOR: 1_000, MIDDLE: 2_500, RICH: 5_000 },
    helpAmount: { POOR: 2_000, MIDDLE: 5_000, RICH: 15_000 },
  },
  'ceremony.rules': {
    kinds: { DOT: { cost: 150_000, respect: 25 }, BAPTEME: { cost: 40_000, respect: 10 }, FUNERAILLES: { cost: 200_000, respect: 30 }, ANNIVERSAIRE: { cost: 15_000, respect: 5 } },
    minGift: 500,
    maxGift: 20_000,
    guestRespect: 3,
    guestMorale: 6,
    minDaysAhead: 1,
    maxDaysAhead: 30,
    maxPerMonth: 2,
    venues: ['hotel_2fevrier', 'palais_congres', 'plage_lome', 'maquis_be', 'deckon', 'stade_kegue', 'place_sokode', 'auberge_kpalime', 'auberge_kara', 'cabaret_dapaong'],
  },
  'utilities.outages': { powerDailyBp: 1_500, powerHours: [2, 10], powerMorale: 4, waterDailyBp: 800, waterHours: [3, 18], waterHygiene: 10, generatorPrice: 85_000, solarPrice: 250_000, tankPrice: 60_000 },
  'economy.events': [
    { id: 'penurie_carburant', weeklyBp: 800, wholesaleBp: { '*': 11_000 }, transportBp: 15_000 },
    { id: 'bonne_recolte', weeklyBp: 1_200, wholesaleBp: { gari: 8_000, mais: 7_500, tomates: 7_000 }, transportBp: 10_000 },
    { id: 'soudure', weeklyBp: 1_000, wholesaleBp: { gari: 13_000, mais: 14_000, tomates: 12_500, huile: 11_500 }, transportBp: 10_000 },
    { id: 'saison_fetes', weeklyBp: 900, wholesaleBp: { pagne_wax: 12_500, tenue: 12_500 }, transportBp: 11_000 },
  ],
  // Tarifs et durées INDICATIFS des cars (gares routières), à vérifier avant lancement
  'travel.intercity': {
    enabled: false,
    cities: [
      { id: 'lome', gare: 'agbalepedo', region: 'MARITIME' },
      { id: 'kpalime', gare: 'gare_kpalime', region: 'PLATEAUX' },
      { id: 'sokode', gare: 'gare_sokode', region: 'CENTRALE' },
      { id: 'kara', gare: 'gare_kara', region: 'KARA' },
      { id: 'dapaong', gare: 'gare_dapaong', region: 'SAVANES' },
    ],
    routes: [
      { a: 'lome', b: 'kpalime', price: 2_500, hours: 3 },
      { a: 'lome', b: 'sokode', price: 6_000, hours: 6 },
      { a: 'lome', b: 'kara', price: 7_000, hours: 7 },
      { a: 'lome', b: 'dapaong', price: 10_000, hours: 10 },
      { a: 'kpalime', b: 'sokode', price: 5_000, hours: 5 },
      { a: 'sokode', b: 'kara', price: 1_500, hours: 2 },
      { a: 'kara', b: 'dapaong', price: 4_000, hours: 4 },
      { a: 'sokode', b: 'dapaong', price: 5_000, hours: 6 },
    ],
    energyPerHour: 1,
  },
  // Prix INDICATIFS (hôtel haut de gamme de Lomé), à vérifier avant lancement ; 100 chambres au total
  'hotel': {
    venueId: 'hotel_2fevrier',
    maxNights: 14,
    rooms: [
      { id: 'standard', count: 60, nightly: 45_000, comfort: 0 },
      { id: 'superieure', count: 30, nightly: 75_000, comfort: 5 },
      { id: 'suite', count: 8, nightly: 150_000, comfort: 10 },
      { id: 'presidentielle', count: 2, nightly: 400_000, comfort: 20 },
    ],
    roomService: [
      { id: 'petit_dej', emoji: '🥐', nameFr: 'Petit-déjeuner continental', nameEn: 'Continental breakfast', price: 6_000, hunger: 25, energy: 8, morale: 5, health: 1 },
      { id: 'poulet_braise', emoji: '🍗', nameFr: 'Poulet braisé et frites d’igname', nameEn: 'Grilled chicken and yam fries', price: 8_500, hunger: 40, energy: 8, morale: 8, health: 0 },
      { id: 'poisson_attieke', emoji: '🐟', nameFr: 'Poisson grillé et attiéké', nameEn: 'Grilled fish and attiéké', price: 9_000, hunger: 40, energy: 8, morale: 8, health: 2 },
      { id: 'jus_frais', emoji: '🍹', nameFr: 'Jus de fruits frais (bissap, ananas)', nameEn: 'Fresh fruit juice (bissap, pineapple)', price: 2_500, hunger: 5, energy: 4, morale: 4, health: 2 },
      { id: 'the_cafe', emoji: '☕', nameFr: 'Thé ou café', nameEn: 'Tea or coffee', price: 1_500, hunger: 2, energy: 6, morale: 2, health: 0 },
    ],
    halls: [
      { id: 'salle_reunion', capacity: 30, daily: 150_000, respect: 3 },
      { id: 'salle_fetes', capacity: 300, daily: 500_000, respect: 8 },
    ],
    partyHall: 'salle_fetes',
  },
  'company.playerJobs': { maxGross: 80_000, maxOpenOffers: 3 },
  'company.portfolio': { maxCompanies: 3, saleShifts: 120, saleShiftsPerEmployee: 40, employeeSaleBp: 3_500, maxCatchUpShifts: 8 },
  // Sans diplôme : du SMIG (52 500) à 80 000 ; les métiers qui demandent une formation ou un diplôme paient davantage
  'jobs.taskPaid': ['car_washer', 'zem_driver', 'delivery_driver', 'cargo_rider', 'street_vendor', 'agent_commercial', 'tailor', 'barber', 'moto_mechanic', 'coiffeur_pro', 'styliste'],
  'jobs.public': { enabled: true, minShifts: 12, bands: { DEBROUILLE: { min: 52_500, max: 80_000 }, QUALIFIE: { min: 85_000, max: 150_000 }, DIPLOME: { min: 160_000, max: 450_000 } } },
  'company.activities': [
    // 6 activités d'origine : id et valeurs inchangés (des entreprises existantes y sont déjà rattachées).
    { id: 'pagnes', nameFr: 'Vente de pagnes', nameEn: 'Wax print trade', revenue: 9_000, cost: 6_000, shiftGameHours: 6, energyCost: 8 },
    { id: 'maquis', nameFr: 'Petit maquis', nameEn: 'Small maquis (eatery)', revenue: 12_000, cost: 8_000, shiftGameHours: 8, energyCost: 11 },
    { id: 'couture', nameFr: 'Atelier de couture', nameEn: 'Tailoring workshop', revenue: 7_000, cost: 3_000, shiftGameHours: 6, energyCost: 6 },
    { id: 'pret_a_porter', nameFr: 'Boutique de prêt-à-porter', nameEn: 'Ready-to-wear clothing shop', revenue: 11_000, cost: 7_000, shiftGameHours: 8, energyCost: 7 },
    { id: 'cyber', nameFr: 'Cybercafé', nameEn: 'Internet café', revenue: 8_000, cost: 4_500, shiftGameHours: 6, energyCost: 5 },
    { id: 'transport', nameFr: 'Transport (zém)', nameEn: 'Moto-taxi transport', revenue: 6_000, cost: 2_000, shiftGameHours: 6, energyCost: 12 },
    // Domaines supplémentaires : même id que dans DEFAULT_DOMAINS (study/content.ts) pour rester cohérent avec
    // les métiers/études. `stylisme` est omis car déjà couvert par `couture`/`pret_a_porter`. Marge horaire
    // ((revenue - cost) / shiftGameHours) calée sur la fourchette des 6 activités d'origine (≈500-666 FCFA/h) :
    // un peu meilleure pour les métiers d'expertise (sante, compta, droit, architecture, cybersecurite, data, rh,
    // banque), un peu plus physique (energyCost plus haut) pour btp, agronomie, environnement, logistique, hotellerie.
    { id: 'btp', nameFr: 'Entreprise de maçonnerie et réfection', nameEn: 'Masonry and building repair business', revenue: 14_000, cost: 9_500, shiftGameHours: 8, energyCost: 14 },
    { id: 'sante', nameFr: 'Cabinet médical privé', nameEn: 'Private medical practice', revenue: 11_000, cost: 6_500, shiftGameHours: 6, energyCost: 6 },
    { id: 'compta', nameFr: "Cabinet d'expertise comptable", nameEn: 'Accounting firm', revenue: 9_500, cost: 5_300, shiftGameHours: 6, energyCost: 4 },
    { id: 'droit', nameFr: "Cabinet d'avocat et de notariat", nameEn: 'Law and notary office', revenue: 10_500, cost: 6_000, shiftGameHours: 6, energyCost: 4 },
    { id: 'pharmacie', nameFr: 'Officine de pharmacie', nameEn: 'Pharmacy', revenue: 13_000, cost: 8_600, shiftGameHours: 8, energyCost: 6 },
    { id: 'coiffure', nameFr: 'Salon de coiffure', nameEn: 'Hair salon', revenue: 8_000, cost: 4_700, shiftGameHours: 6, energyCost: 7 },
    { id: 'hotellerie', nameFr: 'Petite auberge', nameEn: 'Small guesthouse', revenue: 13_500, cost: 9_100, shiftGameHours: 8, energyCost: 9 },
    { id: 'logistique', nameFr: 'Entreprise de transport de marchandises', nameEn: 'Freight transport business', revenue: 14_000, cost: 9_600, shiftGameHours: 8, energyCost: 14 },
    { id: 'mecanique', nameFr: 'Garage auto-moto', nameEn: 'Auto and motorbike garage', revenue: 11_000, cost: 6_800, shiftGameHours: 7, energyCost: 10 },
    { id: 'telecoms', nameFr: 'Boutique de téléphonie', nameEn: 'Phone and airtime shop', revenue: 8_500, cost: 5_200, shiftGameHours: 6, energyCost: 5 },
    { id: 'rh', nameFr: 'Cabinet de recrutement', nameEn: 'Recruitment agency', revenue: 9_000, cost: 5_100, shiftGameHours: 6, energyCost: 4 },
    { id: 'banque', nameFr: 'Micro-finance et tontine formalisée', nameEn: 'Microfinance and savings group', revenue: 9_500, cost: 5_600, shiftGameHours: 6, energyCost: 5 },
    { id: 'architecture', nameFr: "Cabinet d'architecte", nameEn: 'Architecture firm', revenue: 11_000, cost: 6_500, shiftGameHours: 6, energyCost: 5 },
    { id: 'environnement', nameFr: 'Collecte et recyclage de déchets', nameEn: 'Waste collection and recycling', revenue: 10_000, cost: 6_000, shiftGameHours: 8, energyCost: 16 },
    { id: 'cybersecurite', nameFr: 'Société de sécurité informatique', nameEn: 'IT security company', revenue: 10_200, cost: 6_000, shiftGameHours: 6, energyCost: 5 },
    { id: 'data', nameFr: "Agence d'analyse de données", nameEn: 'Data analytics agency', revenue: 10_200, cost: 6_000, shiftGameHours: 6, energyCost: 5 },
    { id: 'agronomie', nameFr: 'Petite exploitation agricole', nameEn: 'Small farm', revenue: 10_160, cost: 6_000, shiftGameHours: 8, energyCost: 16 },
    { id: 'education', nameFr: 'Centre de soutien scolaire', nameEn: 'Tutoring centre', revenue: 8_400, cost: 5_100, shiftGameHours: 6, energyCost: 5 },
    { id: 'journalisme', nameFr: 'Agence de communication', nameEn: 'Communication agency', revenue: 8_700, cost: 5_400, shiftGameHours: 6, energyCost: 5 },
    { id: 'informatique', nameFr: 'Société de services informatiques', nameEn: 'IT services company', revenue: 10_200, cost: 6_000, shiftGameHours: 6, energyCost: 5 },
    { id: 'electricite', nameFr: "Entreprise d'installation électrique", nameEn: 'Electrical installation business', revenue: 11_000, cost: 6_800, shiftGameHours: 7, energyCost: 12 },
  ],
  'market.tenders': {
    sectors: [
      'pagnes', 'maquis', 'couture', 'pret_a_porter', 'cyber', 'transport',
      'btp', 'sante', 'compta', 'droit', 'pharmacie', 'coiffure', 'hotellerie', 'logistique', 'mecanique',
      'telecoms', 'rh', 'banque', 'architecture', 'environnement', 'cybersecurite', 'data', 'agronomie',
      'education', 'journalisme', 'informatique', 'electricite',
    ],
    autoGenerate: true,
    multiSectorChanceBp: 4_000,
    cadenceGameHours: 12,
    applicationWindowGameHours: 24,
    slotsRange: [1, 4],
    budgetRange: [200_000, 2_000_000],
    maxHoursRange: [24, 240],
    sessionsRange: [3, 15],
    scoreWeightsBp: { priceBp: 7_000, hoursBp: 3_000 },
  },
  'study': {
    venueId: 'universite',
    domains: DEFAULT_DOMAINS,
    bt: [
      { series: 'g2', domain: 'compta', nameFr: 'Bac G2 — Comptabilité et gestion', nameEn: 'Bac G2 — Accounting and management' },
      { series: 'g3', domain: 'commerce', nameFr: 'Bac G3 — Techniques commerciales', nameEn: 'Bac G3 — Commercial techniques' },
      { series: 'f3', domain: 'electricite', nameFr: 'Bac F3 — Électrotechnique', nameEn: 'Bac F3 — Electrical engineering' },
      { series: 'f4', domain: 'btp', nameFr: 'Bac F4 — Génie civil', nameEn: 'Bac F4 — Civil engineering' },
      { series: 'h', domain: 'informatique', nameFr: 'Bac H — Informatique de gestion', nameEn: 'Bac H — Business computing' },
      { series: 'f1', domain: 'mecanique', nameFr: 'Bac F1 — Construction mécanique', nameEn: 'Bac F1 — Mechanical engineering' },
      { series: 'f2', domain: 'telecoms', nameFr: 'Bac F2 — Électronique', nameEn: 'Bac F2 — Electronics' },
      { series: 'g1', domain: 'rh', nameFr: 'Bac G1 — Techniques administratives', nameEn: 'Bac G1 — Administrative techniques' },
    ],
    cycles: {
      BT: { years: 1, fee: 60_000, sessionsPerYear: 3 },
      BTS: { years: 2, fee: 100_000, sessionsPerYear: 3 },
      LICENCE: { years: 3, fee: 150_000, sessionsPerYear: 3 },
      MASTER: { years: 2, fee: 250_000, sessionsPerYear: 4 },
      DOCTORAT: { years: 1, fee: 400_000, sessionsPerYear: 6 },
    },
    minCorrectBp: 6_000,
    sessionEnergy: 8,
    sessionHunger: 5,
    respectReward: { BT: 5, BTS: 8, LICENCE: 10, MASTER: 15, DOCTORAT: 25 },
    jobReq: {
      aide_comptable: { min: 'BT', domains: ['compta', 'commerce'] },
      assistant_financier: { min: 'BT', domains: ['compta'] },
      electricien_batiment: { min: 'BT', domains: ['electricite'] },
      technicien_btp: { min: 'BT', domains: ['btp'] },
      technicien_info: { min: 'BT', domains: ['informatique'] },
      accountant: { min: 'LICENCE', domains: ['compta'] },
      developpeur: { min: 'LICENCE', domains: ['informatique'] },
      journaliste: { min: 'LICENCE', domains: ['journalisme'] },
      responsable_commercial: { min: 'LICENCE', domains: ['commerce'] },
      conducteur_travaux: { min: 'LICENCE', domains: ['btp'] },
      ingenieur_electricien: { min: 'LICENCE', domains: ['electricite'] },
      styliste: { min: 'LICENCE', domains: ['stylisme'] },
      coiffeur_pro: { min: 'LICENCE', domains: ['coiffure'] },
      chef_projet_it: { min: 'MASTER', domains: ['informatique'] },
      directeur_financier: { min: 'MASTER', domains: ['compta'] },
      redacteur_en_chef: { min: 'MASTER', domains: ['journalisme'] },
      directeur_commercial: { min: 'MASTER', domains: ['commerce'] },
      ingenieur_btp: { min: 'MASTER', domains: ['btp'] },
      ingenieur_energie: { min: 'MASTER', domains: ['electricite'] },
      directeur_creation: { min: 'MASTER', domains: ['stylisme'] },
      directeur_salon: { min: 'MASTER', domains: ['coiffure'] },
      mecanicien_auto: { min: 'BT', domains: ['mecanique'] },
      technicien_reseaux: { min: 'BT', domains: ['telecoms'] },
      agent_commercial_yas: { min: 'BT', domains: ['commerce', 'telecoms'] },
      charge_communication: { min: 'LICENCE', domains: ['journalisme', 'commerce'] },
      developpeur_mobile: { min: 'LICENCE', domains: ['informatique'] },
      chef_projet_telecom: { min: 'MASTER', domains: ['telecoms', 'informatique'] },
      directeur_communication: { min: 'MASTER', domains: ['journalisme', 'commerce'] },
      secretaire_direction: { min: 'BT', domains: ['rh'] },
      infirmier: { min: 'LICENCE', domains: ['sante'] },
      preparateur_pharma: { min: 'BTS', domains: ['pharmacie', 'sante'] },
      juriste: { min: 'LICENCE', domains: ['droit'] },
      professeur_college: { min: 'LICENCE', domains: ['education'] },
      technicien_agricole: { min: 'BTS', domains: ['agronomie'] },
      receptionniste: { min: 'BTS', domains: ['hotellerie'] },
      declarant_douane: { min: 'BTS', domains: ['logistique', 'droit'] },
      technicien_maintenance: { min: 'BTS', domains: ['mecanique'] },
      administrateur_reseaux: { min: 'LICENCE', domains: ['telecoms', 'informatique'] },
      assistant_rh: { min: 'BTS', domains: ['rh'] },
      charge_clientele: { min: 'LICENCE', domains: ['banque', 'compta'] },
      dessinateur_projeteur: { min: 'BTS', domains: ['architecture', 'btp'] },
      technicien_assainissement: { min: 'BTS', domains: ['environnement'] },
      medecin: { min: 'MASTER', domains: ['sante'] },
      pharmacien: { min: 'MASTER', domains: ['pharmacie'] },
      avocat: { min: 'MASTER', domains: ['droit'] },
      proviseur: { min: 'MASTER', domains: ['education'] },
      ingenieur_agronome: { min: 'MASTER', domains: ['agronomie'] },
      directeur_hotel: { min: 'MASTER', domains: ['hotellerie'] },
      responsable_logistique: { min: 'MASTER', domains: ['logistique'] },
      ingenieur_mecanique: { min: 'MASTER', domains: ['mecanique'] },
      ingenieur_telecom: { min: 'MASTER', domains: ['telecoms'] },
      drh: { min: 'MASTER', domains: ['rh'] },
      directeur_agence: { min: 'MASTER', domains: ['banque'] },
      architecte: { min: 'MASTER', domains: ['architecture'] },
      ingenieur_environnement: { min: 'MASTER', domains: ['environnement'] },
      architecte_logiciel: { min: 'MASTER', domains: ['informatique'] },
      analyste_cybersecurite: { min: 'LICENCE', domains: ['cybersecurite', 'informatique', 'telecoms'] },
      pentester: { min: 'MASTER', domains: ['cybersecurite'] },
      rssi: { min: 'MASTER', domains: ['cybersecurite'] },
      analyste_donnees: { min: 'LICENCE', domains: ['data', 'informatique'] },
      data_scientist: { min: 'MASTER', domains: ['data'] },
      ingenieur_ia: { min: 'MASTER', domains: ['data', 'informatique'] },
      enseignant_chercheur: { min: 'DOCTORAT' },
      consultant_expert: { min: 'DOCTORAT' }
    },
  },
  'school.class': { lateMinutes: 30 },
  'conference': { venueId: 'universite', startHour: 18, hours: 2, everyDays: 3, offsetDay: 1, fee: 2_000, lateMinutes: 30, morale: 4, respect: 3, energy: 10, topics: DEFAULT_TOPICS },
  'school.courses': DEFAULT_COURSES,
  'work.night': { fromHour: 20, toHour: 6, bonusBp: 5_000 },
  'work.zemBike': { gozemFee: 1_500, ownerFee: 2_000, ownKm: 25 },
  'work.anyHour': ['zem_driver', 'delivery_driver'],
  'work.places': { zem_driver: 'station_zem', delivery_driver: 'supermarche', street_vendor: 'marche_assigame', car_washer: 'lavage_auto', tailor: 'marche_assigame', accountant: 'cnss', maquis_waiter: 'maquis_be', shop_clerk: 'boutique', cyber_attendant: 'universite', barber: 'marche_assigame', moto_mechanic: 'station_zem', hotel_waiter: 'hotel_2fevrier', cargo_rider: 'station_zem', agent_commercial: 'marche_assigame', aide_comptable: 'cnss', assistant_financier: 'cnss', electricien_batiment: 'btp', technicien_btp: 'btp', technicien_info: 'capture_media', developpeur: 'capture_media', journaliste: 'studio_ori_infos', responsable_commercial: 'supermarche', conducteur_travaux: 'btp', ingenieur_electricien: 'btp', styliste: 'marche_assigame', coiffeur_pro: 'marche_assigame', chef_projet_it: 'capture_media', directeur_financier: 'otr', redacteur_en_chef: 'studio_ori_infos', directeur_commercial: 'supermarche', ingenieur_btp: 'btp', ingenieur_energie: 'btp', directeur_creation: 'marche_assigame', directeur_salon: 'marche_assigame', enseignant_chercheur: 'universite', consultant_expert: 'otr', vendeur_mode: 'mode_assigame', agent_securite: 'supermarche', mecanicien_auto: 'station_total', technicien_reseaux: 'yas', secretaire_direction: 'cnss', infirmier: 'chu', preparateur_pharma: 'chr_commune', juriste: 'cnss', professeur_college: 'universite', technicien_agricole: 'marche_agoe', receptionniste: 'hotel_2fevrier', declarant_douane: 'port', technicien_maintenance: 'port', administrateur_reseaux: 'yas', agent_commercial_yas: 'yas', charge_communication: 'yas', developpeur_mobile: 'yas', chef_projet_telecom: 'yas', directeur_communication: 'yas', assistant_rh: 'cnss', charge_clientele: 'bank_ecobank_2', dessinateur_projeteur: 'btp', technicien_assainissement: 'chr_commune', medecin: 'chu_campus', pharmacien: 'chu', avocat: 'palais_lome', proviseur: 'universite', ingenieur_agronome: 'marche_agoe', directeur_hotel: 'hotel_2fevrier', responsable_logistique: 'port', ingenieur_mecanique: 'port', ingenieur_telecom: 'yas', drh: 'cnss', directeur_agence: 'bank_boa_1', architecte: 'btp', ingenieur_environnement: 'boad', architecte_logiciel: 'capture_media', analyste_cybersecurite: 'yas', pentester: 'moov_africa', rssi: 'bceao', analyste_donnees: 'capture_media', data_scientist: 'capture_media', ingenieur_ia: 'capture_media' },
  // Épargne : intérêts simples par jour de jeu sur le solde (versés à la consultation), plafond du compte
  'savings': { dailyBp: 3, maxBalance: 50_000_000 },
  // Banques et microfinance : taux INDICATIFS du jeu (inspirés des niveaux de la zone UEMOA), pas les conditions réelles.
  // Livret : intérêts quotidiens ; DAT : intérêts simples versés à l'échéance (mois de jeu de 30 jours).
  'banks': [
    { id: 'nsia', name: 'NSIA Banque Togo', kind: 'BANK', savingsYearBp: 350, minSavings: 5_000, minTerm: 100_000, terms: [{ months: 3, yearBp: 360 }, { months: 6, yearBp: 430 }, { months: 12, yearBp: 550 }, { months: 24, yearBp: 700 }] },
    { id: 'ecobank', name: 'Ecobank Togo', kind: 'BANK', savingsYearBp: 350, minSavings: 5_000, minTerm: 100_000, terms: [{ months: 3, yearBp: 400 }, { months: 6, yearBp: 500 }, { months: 12, yearBp: 650 }, { months: 24, yearBp: 850 }] },
    { id: 'fucec', name: 'FUCEC-Togo', kind: 'MFI', savingsYearBp: 350, minSavings: 2_000, minTerm: 25_000, terms: [{ months: 3, yearBp: 350 }, { months: 6, yearBp: 420 }, { months: 12, yearBp: 520 }, { months: 24, yearBp: 650 }] },
    { id: 'boa', name: 'BOA Togo', kind: 'BANK', savingsYearBp: 350, minSavings: 5_000, minTerm: 100_000, terms: [{ months: 3, yearBp: 400 }, { months: 6, yearBp: 490 }, { months: 12, yearBp: 640 }, { months: 24, yearBp: 830 }] },
    { id: 'ibbank', name: 'IB Bank Togo', kind: 'BANK', savingsYearBp: 375, minSavings: 5_000, minTerm: 100_000, terms: [{ months: 3, yearBp: 370 }, { months: 6, yearBp: 450 }, { months: 12, yearBp: 580 }, { months: 24, yearBp: 740 }] },
    { id: 'orabank', name: 'Orabank Togo', kind: 'BANK', savingsYearBp: 350, minSavings: 5_000, minTerm: 100_000, terms: [{ months: 3, yearBp: 390 }, { months: 6, yearBp: 480 }, { months: 12, yearBp: 630 }, { months: 24, yearBp: 810 }] },
  ],
  // Prêt bancaire personnel : plafond fixe 2 000 000 FCFA, taux simple 18 %/an, 12 mensualités sur 360 jours de
  // jeu (1 an), pénalité de retard 0,5 %/jour (bornée dans economy/loans.ts).
  'bank.loans': { capAmount: 2_000_000, rateBp: 1_800, termDays: 360, installmentsCount: 12, lateFeeBpPerDay: 50 },
  // FCFA pour 1 unité de devise : parité fixe pour l'euro, autres taux indicatifs (modifiables)
  'fx.rates': { EUR: 655.957, USD: 600, NGN: 0.4, GHS: 40, GBP: 760 },
  // Investissements (simulation de jeu, sociétés fictives) : bourse, saisons agricoles, secondes activités
  'industry': {
    maxAccrualDays: 60,
    transferTaxBp: 300,
    maxAskMultiple: 3,
    build: { priceBp: 8_000, startupMultiple: 3, maxPerType: 100 },
    equipment: { borehole: { priceBp: 300, minPrice: 4_000_000, waterSaveBp: 8_000, pumpPowerBp: 3_000, serviceEveryDays: 30, serviceBp: 200, breakdownBp: 100, repairBp: 600 }, solar: { priceBp: 1_500, minPrice: 15_000_000, powerSaveBp: 6_000, serviceEveryDays: 60, serviceBp: 150, breakdownBp: 50, repairBp: 400 } },
    plants: [
      { id: 'savonnerie', kind: 'FACTORY', emoji: '🧼', nameFr: 'Savonnerie de Lomé', nameEn: 'Lomé soap factory', descFr: 'Savon de ménage et de toilette vendu dans toute la sous-région.', descEn: 'Soap for the home and the bath sold across the region.', districtFr: 'Zone industrielle', districtEn: 'Industrial zone', units: 4, price: 120_000_000, maxStaff: 40, wagePerStaff: 3_500, dailyRevenueBp: 60, startupGameDays: 10 },
      { id: 'huilerie', kind: 'FACTORY', emoji: '🫒', nameFr: 'Huilerie de palme du Golfe', nameEn: 'Gulf palm oil mill', descFr: 'Huile de palme raffinée pour les marchés et les supermarchés.', descEn: 'Refined palm oil for markets and supermarkets.', districtFr: 'Agoè', districtEn: 'Agoè', units: 3, price: 200_000_000, maxStaff: 60, wagePerStaff: 3_500, dailyRevenueBp: 55, startupGameDays: 10 },
      { id: 'eau_minerale', kind: 'FACTORY', emoji: '💧', nameFr: 'Usine d’eau minérale', nameEn: 'Mineral water plant', descFr: 'Eau en sachets et en bouteilles pour tout Lomé.', descEn: 'Bagged and bottled water for all of Lomé.', districtFr: 'Kégué', districtEn: 'Kégué', units: 4, price: 250_000_000, maxStaff: 50, wagePerStaff: 3_500, dailyRevenueBp: 50, startupGameDays: 10 },
      { id: 'minoterie', kind: 'FACTORY', emoji: '🌾', nameFr: 'Grande minoterie', nameEn: 'Large flour mill', descFr: 'Farine de blé et de maïs pour les boulangeries.', descEn: 'Wheat and maize flour for bakeries.', districtFr: 'Port autonome', districtEn: 'Autonomous port', units: 3, price: 400_000_000, maxStaff: 80, wagePerStaff: 4_000, dailyRevenueBp: 50, startupGameDays: 10 },
      { id: 'brasserie', kind: 'FACTORY', emoji: '🍺', nameFr: 'Brasserie de la Lagune', nameEn: 'Lagoon brewery', descFr: 'Bières et boissons gazeuses du pays.', descEn: 'Local beers and soft drinks.', districtFr: 'Zone industrielle', districtEn: 'Industrial zone', units: 3, price: 800_000_000, maxStaff: 150, wagePerStaff: 4_000, dailyRevenueBp: 45, startupGameDays: 14 },
      { id: 'cimenterie_ind', kind: 'FACTORY', emoji: '🏗️', nameFr: 'Cimenterie industrielle', nameEn: 'Industrial cement works', descFr: 'Clinker et ciment en sacs pour les chantiers de la côte.', descEn: 'Clinker and bagged cement for coastal building sites.', districtFr: 'Kégué-Est', districtEn: 'East Kégué', units: 3, price: 1_500_000_000, maxStaff: 250, wagePerStaff: 4_500, dailyRevenueBp: 40, startupGameDays: 20 },
      { id: 'raffinerie', kind: 'FACTORY', emoji: '🛢️', nameFr: 'Raffinerie de pétrole', nameEn: 'Oil refinery', descFr: 'Carburants raffinés pour les stations et le Sahel.', descEn: 'Refined fuels for stations and the Sahel.', districtFr: 'Port autonome', districtEn: 'Autonomous port', units: 2, price: 5_000_000_000, maxStaff: 400, wagePerStaff: 6_000, dailyRevenueBp: 38, startupGameDays: 30 },
      { id: 'zone_franche_lome', kind: 'FREE_ZONE', emoji: '🏭', nameFr: 'Zone franche de Lomé', nameEn: 'Lomé free zone', descFr: 'Un parc d’entreprises exportatrices, sans droits de douane : tu loues les parcelles et tu emploies.', descEn: 'An export-business park with no customs duties: you lease the plots and employ staff.', districtFr: 'Lomé-Port', districtEn: 'Lomé port', units: 8, price: 3_000_000_000, maxStaff: 600, wagePerStaff: 3_800, dailyRevenueBp: 35, startupGameDays: 15 },
      { id: 'zone_franche_agoe', kind: 'FREE_ZONE', emoji: '🧵', nameFr: 'Zone franche d’Agoè', nameEn: 'Agoè free zone', descFr: 'Ateliers de textile et de transformation, fiscalité allégée.', descEn: 'Textile and processing workshops, light taxation.', districtFr: 'Agoè', districtEn: 'Agoè', units: 6, price: 6_000_000_000, maxStaff: 1200, wagePerStaff: 3_800, dailyRevenueBp: 32, startupGameDays: 15 },
      { id: 'zone_franche_kpeme', kind: 'FREE_ZONE', emoji: '⚙️', nameFr: 'Zone franche de Kpémé', nameEn: 'Kpémé free zone', descFr: 'La grande plateforme industrielle de l’est, près des phosphates.', descEn: 'The big industrial platform in the east, near the phosphates.', districtFr: 'Kpémé', districtEn: 'Kpémé', units: 4, price: 12_000_000_000, maxStaff: 2500, wagePerStaff: 3_800, dailyRevenueBp: 30, startupGameDays: 15 },
      { id: 'plantation_fruits', kind: 'FARM', emoji: '🍍', nameFr: 'Plantation fruitière', nameEn: 'Fruit plantation', descFr: 'Ananas, mangues et papayes vendus aux marchés de Lomé et à l’export.', descEn: 'Pineapples, mangoes and papayas sold to Lomé markets and abroad.', districtFr: 'Kpalimé', districtEn: 'Kpalimé', units: 6, price: 60_000_000, maxStaff: 40, wagePerStaff: 2_500, dailyRevenueBp: 70, startupGameDays: 12 },
      { id: 'ferme_cereales', kind: 'FARM', emoji: '🌽', nameFr: 'Ferme céréalière', nameEn: 'Grain farm', descFr: 'De grands champs de maïs, de riz et de sorgho, récoltés à la machine.', descEn: 'Large fields of maize, rice and sorghum, machine-harvested.', districtFr: 'Notsé', districtEn: 'Notsé', units: 6, price: 90_000_000, maxStaff: 50, wagePerStaff: 2_500, dailyRevenueBp: 65, startupGameDays: 12 },
      { id: 'maraichage_pro', kind: 'FARM', emoji: '🥬', nameFr: 'Grand maraîchage', nameEn: 'Market garden estate', descFr: 'Tomates, piment, gombo et oignons livrés chaque matin aux marchés.', descEn: 'Tomatoes, chilli, okra and onions delivered to the markets every morning.', districtFr: 'Agoè', districtEn: 'Agoè', units: 10, price: 25_000_000, maxStaff: 20, wagePerStaff: 2_500, dailyRevenueBp: 80, startupGameDays: 6 },
      { id: 'elevage_volailles', kind: 'LIVESTOCK', emoji: '🐔', nameFr: 'Élevage de volailles', nameEn: 'Poultry farm', descFr: 'Poulets de chair et œufs pour les maquis, les hôtels et les marchés.', descEn: 'Broilers and eggs for maquis, hotels and markets.', districtFr: 'Tsévié', districtEn: 'Tsévié', units: 8, price: 40_000_000, maxStaff: 25, wagePerStaff: 2_500, dailyRevenueBp: 75, startupGameDays: 6 },
      { id: 'ranch_bovins', kind: 'LIVESTOCK', emoji: '🐂', nameFr: 'Ranch de bœufs, moutons et chèvres', nameEn: 'Cattle, sheep and goat ranch', descFr: 'Grand troupeau en savane : bêtes vendues pour la Tabaski, les fêtes et les boucheries.', descEn: 'A big herd on the savanna: animals sold for Tabaski, celebrations and butchers.', districtFr: 'Kara', districtEn: 'Kara', units: 4, price: 300_000_000, maxStaff: 60, wagePerStaff: 2_800, dailyRevenueBp: 60, startupGameDays: 8 },
      { id: 'porcherie', kind: 'LIVESTOCK', emoji: '🐖', nameFr: 'Porcherie moderne', nameEn: 'Modern pig farm', descFr: 'Porcs élevés en bâtiments propres, vendus aux charcutiers et aux restaurants.', descEn: 'Pigs raised in clean sheds, sold to butchers and restaurants.', districtFr: 'Aného', districtEn: 'Aného', units: 6, price: 80_000_000, maxStaff: 20, wagePerStaff: 2_500, dailyRevenueBp: 75, startupGameDays: 8 },
      { id: 'pisciculture', kind: 'LIVESTOCK', emoji: '🐟', nameFr: 'Pisciculture du lac Togo', nameEn: 'Lake Togo fish farm', descFr: 'Bassins et cages flottantes : tilapia et silures frais pour les marchés.', descEn: 'Ponds and floating cages: fresh tilapia and catfish for the markets.', districtFr: 'Lac Togo', districtEn: 'Lake Togo', units: 6, price: 50_000_000, maxStaff: 20, wagePerStaff: 2_500, dailyRevenueBp: 70, startupGameDays: 8 },
    ],
    // Charges fixes (gardiennage, entretien) + eau et électricité proportionnelles à la production du jour
    risk: { swingMinBp: 6_000, swingMaxBp: 13_000, incidentBp: 400, fixedCostBp: 4, demandMinBp: 7_000, demandMaxBp: 13_000, spoilBp: { FACTORY: 50, FREE_ZONE: 30, FARM: 400, LIVESTOCK: 250 }, waterBp: { FACTORY: 150, FREE_ZONE: 100, FARM: 350, LIVESTOCK: 300 }, powerBp: { FACTORY: 450, FREE_ZONE: 300, FARM: 150, LIVESTOCK: 150 } },
    jobs: {
      maxOpenOffers: 3,
      roles: [
        { id: 'ouvrier', nameFr: 'Ouvrier', nameEn: 'Worker', maxGross: 120_000 },
        { id: 'chef_equipe', nameFr: 'Chef d’équipe', nameEn: 'Team leader', maxGross: 200_000 },
        { id: 'technicien', nameFr: 'Technicien de maintenance', nameEn: 'Maintenance technician', maxGross: 250_000 },
        { id: 'comptable', nameFr: 'Comptable du site', nameEn: 'Site accountant', maxGross: 300_000 },
        { id: 'directeur', nameFr: 'Directeur de site', nameEn: 'Site director', maxGross: 600_000 },
      ],
    },
    investors: [
      { id: 'aboubakar', emoji: '🤴', nameFr: 'M. Aboubakar Sanni', nameEn: 'Mr Aboubakar Sanni', bioFr: 'Négociant du Sahel, il rachète des parts d’usines qui exportent vers le nord.', bioEn: 'Sahel trader who buys stakes in factories exporting north.', minPrice: 100_000_000, maxShareBp: 4_900, offerBp: 13_000, buybackPremiumBp: 12_000 },
      { id: 'fonds_golfe', emoji: '🏦', nameFr: 'Fonds du Golfe', nameEn: 'Gulf Fund', bioFr: 'Fonds d’investissement régional : parts importantes, prudent sur le prix.', bioEn: 'Regional investment fund: large stakes, price-conscious.', minPrice: 500_000_000, maxShareBp: 4_900, offerBp: 11_000, buybackPremiumBp: 10_000 },
      { id: 'mama_benz', emoji: '👑', nameFr: 'Mama Akouvi', nameEn: 'Mama Akouvi', bioFr: 'Grande commerçante de pagnes, riche et exigeante : elle paie bien les sites à forte main-d’œuvre.', bioEn: 'Wax-print merchant, rich and demanding: she pays well for labour-heavy sites.', minPrice: 100_000_000, maxShareBp: 3_000, offerBp: 14_000, buybackPremiumBp: 15_000 },
      { id: 'milliardaire_asie', emoji: '💼', nameFr: 'Groupe Meridian', nameEn: 'Meridian Group', bioFr: 'Un grand groupe étranger : il ne regarde que les très gros sites, mais prend jusqu’à 49 %.', bioEn: 'A large foreign group: only very big sites, takes up to 49%.', minPrice: 3_000_000_000, maxShareBp: 4_900, offerBp: 15_000, buybackPremiumBp: 20_000 },
    ],
  },
  'invest': {
    feeBp: 100,
    maxSharesPerStock: 10_000,
    maxOpenVentures: 5,
    stocks: [
      { symbol: 'GOLFB', nameFr: 'Golfe Banque', nameEn: 'Golfe Bank', sectorFr: 'Banque', sectorEn: 'Banking', base: 6_500, driftBp: 4, volBp: 180 },
      { symbol: 'LCIM', nameFr: 'Lomé Ciments', nameEn: 'Lomé Cement', sectorFr: 'Industrie', sectorEn: 'Industry', base: 3_200, driftBp: 3, volBp: 220 },
      { symbol: 'AGTEL', nameFr: 'AgbéTel', nameEn: 'AgbéTel', sectorFr: 'Télécoms', sectorEn: 'Telecoms', base: 9_800, driftBp: 5, volBp: 200 },
      { symbol: 'PLOG', nameFr: 'Port Logistique Togo', nameEn: 'Port Logistics Togo', sectorFr: 'Transport', sectorEn: 'Transport', base: 4_100, driftBp: 6, volBp: 260 },
      { symbol: 'CAJOU', nameFr: 'Cajou du Centre', nameEn: 'Central Cashew', sectorFr: 'Agro-industrie', sectorEn: 'Agribusiness', base: 1_250, driftBp: 7, volBp: 380 },
      { symbol: 'ANAGO', nameFr: 'Ananas d’Agou SA', nameEn: 'Agou Pineapple PLC', sectorFr: 'Agro-industrie', sectorEn: 'Agribusiness', base: 900, driftBp: 6, volBp: 420 },
      { symbol: 'KENER', nameFr: 'Kara Énergie', nameEn: 'Kara Energy', sectorFr: 'Énergie', sectorEn: 'Energy', base: 2_700, driftBp: 2, volBp: 300 },
      { symbol: 'WAXI', nameFr: 'Wax Industrie Lomé', nameEn: 'Lomé Wax Industries', sectorFr: 'Textile', sectorEn: 'Textiles', base: 1_800, driftBp: 1, volBp: 340 },
      // Banques et microfinance du jeu (mêmes noms que l'app Banque) : cours calmes, dérive lente
      { symbol: 'NSIA', nameFr: 'NSIA Banque Togo', nameEn: 'NSIA Banque Togo', sectorFr: 'Banque', sectorEn: 'Banking', base: 5_400, driftBp: 3, volBp: 150 },
      { symbol: 'ECOBANK', nameFr: 'Ecobank Togo', nameEn: 'Ecobank Togo', sectorFr: 'Banque', sectorEn: 'Banking', base: 7_200, driftBp: 4, volBp: 170 },
      { symbol: 'BOA', nameFr: 'BOA Togo', nameEn: 'BOA Togo', sectorFr: 'Banque', sectorEn: 'Banking', base: 4_800, driftBp: 3, volBp: 160 },
      { symbol: 'ORABANK', nameFr: 'Orabank Togo', nameEn: 'Orabank Togo', sectorFr: 'Banque', sectorEn: 'Banking', base: 3_900, driftBp: 3, volBp: 180 },
      { symbol: 'IBBANK', nameFr: 'IB Bank Togo', nameEn: 'IB Bank Togo', sectorFr: 'Banque', sectorEn: 'Banking', base: 2_900, driftBp: 4, volBp: 200 },
      { symbol: 'FUCEC', nameFr: 'FUCEC-Togo', nameEn: 'FUCEC-Togo', sectorFr: 'Microfinance', sectorEn: 'Microfinance', base: 1_600, driftBp: 2, volBp: 140 },
      // Télécoms, mobile money et mobilité
      { symbol: 'TOGOCEL', nameFr: 'Togocel (Yas)', nameEn: 'Togocel (Yas)', sectorFr: 'Télécoms', sectorEn: 'Telecoms', base: 8_500, driftBp: 4, volBp: 210 },
      { symbol: 'MOOV', nameFr: 'Moov Africa Togo', nameEn: 'Moov Africa Togo', sectorFr: 'Télécoms', sectorEn: 'Telecoms', base: 7_600, driftBp: 4, volBp: 220 },
      { symbol: 'GOZEM', nameFr: 'Gozem', nameEn: 'Gozem', sectorFr: 'Mobilité et services', sectorEn: 'Mobility and services', base: 2_200, driftBp: 8, volBp: 420 },
    ],
    options: [
      { id: 'farm_mais', kind: 'FARM', emoji: '🌽', nameFr: 'Saison de maïs (1 ha, Plateaux)', nameEn: 'Maize season (1 ha, Plateaux)', descFr: 'Semences, engrais et main-d’œuvre. Récolte en 10 jours.', descEn: 'Seeds, fertiliser and labour. Harvest in 10 days.', cost: 60_000, gameDays: 10, minReturnBp: 1000, maxReturnBp: 6000, failBp: 1200 },
      { id: 'farm_soja', kind: 'FARM', emoji: '🫘', nameFr: 'Saison de soja (1 ha, Centrale)', nameEn: 'Soybean season (1 ha, Centrale)', descFr: 'Culture d’export très demandée. Récolte en 12 jours.', descEn: 'High-demand export crop. Harvest in 12 days.', cost: 80_000, gameDays: 12, minReturnBp: 1500, maxReturnBp: 7000, failBp: 1500 },
      { id: 'farm_ananas', kind: 'FARM', emoji: '🍍', nameFr: 'Champ d’ananas (Agou)', nameEn: 'Pineapple field (Agou)', descFr: 'Plus long, mais très rentable. Récolte en 20 jours.', descEn: 'Longer, but very profitable. Harvest in 20 days.', cost: 150_000, gameDays: 20, minReturnBp: 3000, maxReturnBp: 12000, failBp: 1500 },
      { id: 'farm_cajou', kind: 'FARM', emoji: '🥜', nameFr: 'Verger d’anacardiers (Savanes)', nameEn: 'Cashew orchard (Savanes)', descFr: 'Noix de cajou pour l’export. Récolte en 25 jours.', descEn: 'Cashew nuts for export. Harvest in 25 days.', cost: 250_000, gameDays: 25, minReturnBp: 4000, maxReturnBp: 15000, failBp: 1800 },
      { id: 'farm_coton', kind: 'FARM', emoji: '☁️', nameFr: 'Coton (contrat avec la filière)', nameEn: 'Cotton (supply contract)', descFr: 'Prix d’achat garanti, peu de risque. Récolte en 15 jours.', descEn: 'Guaranteed purchase price, low risk. Harvest in 15 days.', cost: 100_000, gameDays: 15, minReturnBp: 1500, maxReturnBp: 3500, failBp: 500 },
      { id: 'elev_chevres', kind: 'FARM', emoji: '🐐', nameFr: 'Élevage de chèvres (10 têtes)', nameEn: 'Goat herd (10 head)', descFr: 'Achat de chevrettes, soins vétérinaire et fourrage. Revente à la tabaski. 20 jours.', descEn: 'Kids, vet care and fodder. Sold at Tabaski. 20 days.', cost: 90_000, gameDays: 20, minReturnBp: 1500, maxReturnBp: 6000, failBp: 1200 },
      { id: 'elev_moutons', kind: 'FARM', emoji: '🐑', nameFr: 'Embouche de moutons (8 bêtes)', nameEn: 'Sheep fattening (8 head)', descFr: 'Engraissement pour la fête de Tabaski. Risque de maladie. 25 jours.', descEn: 'Fattening for Tabaski. Disease risk. 25 days.', cost: 160_000, gameDays: 25, minReturnBp: 2500, maxReturnBp: 9000, failBp: 1500 },
      { id: 'elev_porcs', kind: 'FARM', emoji: '🐖', nameFr: 'Porcherie (6 truies et porcelets)', nameEn: 'Pig farm (6 sows and piglets)', descFr: 'Vente de porcs au marché. Attention à la peste porcine. 30 jours.', descEn: 'Pigs sold at market. Beware of swine fever. 30 days.', cost: 220_000, gameDays: 30, minReturnBp: 3000, maxReturnBp: 10000, failBp: 2000 },
      { id: 'elev_lapins', kind: 'FARM', emoji: '🐇', nameFr: 'Clapier de lapins (50 lapins)', nameEn: 'Rabbit hutch (50 rabbits)', descFr: 'Petit élevage rapide, viande vendue aux restaurants. 15 jours.', descEn: 'Quick small farm, meat sold to restaurants. 15 days.', cost: 70_000, gameDays: 15, minReturnBp: 1000, maxReturnBp: 4500, failBp: 1000 },
      { id: 'elev_bovins', kind: 'FARM', emoji: '🐂', nameFr: 'Embouche de bovins (5 bœufs, Savanes)', nameEn: 'Cattle fattening (5 oxen, Savanes)', descFr: 'Gros investissement, forte valeur à la revente. 45 jours.', descEn: 'Large investment, high resale value. 45 days.', cost: 600_000, gameDays: 45, minReturnBp: 3500, maxReturnBp: 12000, failBp: 1800 },
      { id: 'terre_adidogome', kind: 'FARM', emoji: '🏞️', nameFr: 'Terrain à bâtir (Adidogomé)', nameEn: 'Building plot (Adidogomé)', descFr: 'Tu achètes un terrain, tu le gardes, puis tu le revends quand le quartier se construit. 60 jours.', descEn: 'Buy a plot, hold it, then resell as the area gets built up. 60 days.', cost: 500_000, gameDays: 60, minReturnBp: 1000, maxReturnBp: 5000, failBp: 600 },
      { id: 'terre_plateaux', kind: 'FARM', emoji: '🌳', nameFr: 'Terrain agricole (Plateaux, 2 ha)', nameEn: 'Farmland (Plateaux, 2 ha)', descFr: 'Achat de terres cultivables à revendre ou à louer. Valeur qui monte lentement. 90 jours.', descEn: 'Buy arable land to resell or lease. Value rises slowly. 90 days.', cost: 300_000, gameDays: 90, minReturnBp: 800, maxReturnBp: 4000, failBp: 500 },
      { id: 'biz_moulin', kind: 'BUSINESS', emoji: '⚙️', nameFr: 'Moulin à maïs de quartier', nameEn: 'Neighbourhood maize mill', descFr: 'Les voisines viennent moudre chaque jour. Revenu pendant 30 jours.', descEn: 'Neighbours come to grind every day. Income for 30 days.', cost: 200_000, gameDays: 30, minReturnBp: 2000, maxReturnBp: 6000, failBp: 1000 },
      { id: 'biz_zem', kind: 'BUSINESS', emoji: '🛵', nameFr: 'Moto confiée à un zémidjan', nameEn: 'Motorbike entrusted to a zem rider', descFr: 'Le conducteur te verse une part chaque jour. Risque d’accident ou de vol.', descEn: 'The rider pays you a share every day. Risk of accident or theft.', cost: 450_000, gameDays: 40, minReturnBp: 3000, maxReturnBp: 7000, failBp: 2000 },
      { id: 'biz_kiosque', kind: 'BUSINESS', emoji: '📱', nameFr: 'Kiosque de recharge et mobile money', nameEn: 'Top-up and mobile money kiosk', descFr: 'Commissions sur les dépôts et recharges. Revenu pendant 30 jours.', descEn: 'Commissions on deposits and top-ups. Income for 30 days.', cost: 150_000, gameDays: 30, minReturnBp: 1500, maxReturnBp: 4500, failBp: 800 },
      { id: 'biz_poulailler', kind: 'BUSINESS', emoji: '🐔', nameFr: 'Poulailler (500 poules pondeuses)', nameEn: 'Poultry farm (500 laying hens)', descFr: 'Vente d’œufs au marché. Attention aux épidémies.', descEn: 'Egg sales at the market. Beware of epidemics.', cost: 350_000, gameDays: 35, minReturnBp: 2500, maxReturnBp: 8000, failBp: 1800 },
    ],
  },
  // Prix du m² : de ~1 200 FCFA en rase campagne à 30 000 au cœur de Lomé, majoré en bordure du boulevard Eyadéma et près du littoral
  'land': {
    lotM2: 600,
    quarterM2: 150,
    maxM2PerPlayer: 150_000,
    maxPicksPerPurchase: 40,
    purchaseFeeBp: 200,
    transferTaxBp: 500,
    maxAskMultiple: 5,
    price: { hubX: 20, hubZ: -50, centerPerM2: 36_000, edgePerM2: 1_440, halfDistance: 150, roads: [{ axis: 'x', at: 0 }], roadBonusBp: 3_000, roadRange: 40, seaZ: 36, seaBonusBp: 4_000, seaRange: 60 },
    zones: [
      { id: 'lotissement', nameFr: 'Lotissement d’Adidogomé', nameEn: 'Adidogomé estate', descFr: 'Lots viabilisés de 600 m² au prix fixe, au sud du dernier boulevard : le plus simple pour acheter un terrain et faire bâtir sa maison.', descEn: 'Serviced 600 m² lots at a fixed price south of the last boulevard: the simplest way to buy land and have your house built.', originX: -120, originZ: -137, cols: 6, rows: 2, cell: 10, tierBp: 10_000, fixedPerM2: 1_601, margin: 1, sign: false },
      // Parcelles en mer (prestige) : mêmes lots et quarts qu'à terre, prix fixe du m² double puis triple du plus cher à terre (≈ 61 000 FCFA/m²), à gauche du port, après les carreaux de la grille de cases de publicité (`sea.plots` : x −200…88, z 44…188), donc à l'ouest de x −200
      { id: 'mer_lagon', nameFr: 'Mer – Lagon de prestige', nameEn: 'Sea – Prestige lagoon', descFr: 'Parcelles sur l’eau, à gauche du port, après les carreaux de publicité : le double du prix du terrain le plus cher de la ville. Lots, demis, tiers ou quarts, comme à terre.', descEn: 'Plots on the water, left of the port, past the advertising squares: double the price of the dearest city land. Whole lots, halves, thirds or quarters, as on land.', originX: -290, originZ: 50, cols: 8, rows: 4, cell: 10, tierBp: 10_000, fixedPerM2: 120_000, margin: 4, sign: false, water: true, startRows: 2 },
      { id: 'mer_large', nameFr: 'Mer – Grand large', nameEn: 'Sea – Open water', descFr: 'Les parcelles les plus exclusives du jeu, au large, derrière le lagon : le triple du terrain le plus cher de la ville.', descEn: 'The most exclusive plots in the game, further out, behind the lagoon: triple the dearest city land.', originX: -290, originZ: 100, cols: 8, rows: 4, cell: 10, tierBp: 10_000, fixedPerM2: 180_000, margin: 4, sign: false, water: true, startRows: 2 },
      { id: 'mer_baie', nameFr: 'Mer – Baie des palmes', nameEn: 'Sea – Palm bay', descFr: 'Une troisième rangée de parcelles sur l’eau, toujours à gauche du port : le triple du terrain le plus cher de la ville.', descEn: 'A third row of plots on the water, still left of the port: triple the dearest city land.', originX: -290, originZ: 150, cols: 8, rows: 4, cell: 10, tierBp: 10_000, fixedPerM2: 180_000, margin: 4, sign: false, water: true, startRows: 2 },
      { id: 'mer_horizon', nameFr: 'Mer – Horizon', nameEn: 'Sea – Horizon', descFr: 'Les parcelles les plus lointaines et les plus chères du jeu, face à l’horizon : plus de trois fois le terrain le plus cher de la ville.', descEn: 'The furthest and dearest plots in the game, facing the horizon: over triple the dearest city land.', originX: -290, originZ: 200, cols: 8, rows: 4, cell: 10, tierBp: 10_000, fixedPerM2: 200_000, margin: 4, sign: false, water: true, startRows: 2 },
      // Terrain de bord de mer, à l'ouest de la route sur l'eau, près de la plage (à la place de l'ancien îlot d'immeubles)
      { id: 'mer_corniche', nameFr: 'Mer – Front de mer', nameEn: 'Sea – Seafront', descFr: 'Le grand terrain au bord de l’eau, près de la plage et au bout de la corniche ouest : la parcelle la plus proche de la ville.', descEn: 'The big plot at the water’s edge, near the beach at the end of the west corniche: the plot closest to town.', originX: -384, originZ: 46, cols: 6, rows: 3, cell: 10, tierBp: 10_000, fixedPerM2: 150_000, margin: 4, sign: false, water: true },
      // Rive ouest de la route sur l'eau (décor : front/src/game/seaDistrict.ts), de l'autre côté de la chaussée
      { id: 'mer_ouest', nameFr: 'Mer – Rive ouest', nameEn: 'Sea – West shore', descFr: 'Parcelles de l’autre côté de la route sur l’eau, face au large : le triple du terrain le plus cher de la ville.', descEn: 'Plots on the other side of the causeway, facing open water: triple the dearest city land.', originX: -352, originZ: 100, cols: 3, rows: 6, cell: 10, tierBp: 10_000, fixedPerM2: 180_000, margin: 4, sign: false, water: true, startRows: 3 },
      { id: 'mer_ouest_sud', nameFr: 'Mer – Rive ouest Sud', nameEn: 'Sea – South west shore', descFr: 'La suite de la rive ouest, plus loin sur la route : encore plus exclusif.', descEn: 'The west shore further along the causeway: even more exclusive.', originX: -352, originZ: 180, cols: 3, rows: 6, cell: 10, tierBp: 10_000, fixedPerM2: 200_000, margin: 4, sign: false, water: true, startRows: 3 },
      { id: 'adidogome_ouest', nameFr: 'Adidogomé-Ouest', nameEn: 'West Adidogomé', descFr: 'Bande de terrains à l’ouest de la ville, desservie par la route d’Adidogomé. De nouvelles rangées s’ouvrent à mesure que les lots se vendent.', descEn: 'Strip of plots west of the city on the Adidogomé road. New rows open as lots sell.', originX: -139, originZ: -412, cols: 2, rows: 11, cell: 8, tierBp: 10000, startRows: 3 },
      { id: 'agoe_nord', nameFr: 'Agoè-Nord', nameEn: 'North Agoè', descFr: 'Immense zone au nord-est : grandes parcelles peu chères, idéales pour l’agriculture et l’élevage. Elle s’étend au fil des achats.', descEn: 'Huge north-east zone: large cheap plots, ideal for farming and livestock. It grows as plots are bought.', originX: 86, originZ: -467, cols: 18, rows: 14, cell: 8, tierBp: 10000, startRows: 4 },
      { id: 'kegue_est', nameFr: 'Kégué-Est', nameEn: 'East Kégué', descFr: 'Terrains en bordure du grand contournement, à l’est : entrepôts, cimenterie et briqueterie y trouvent leur place.', descEn: 'Plots along the eastern bypass: warehouses, cement and brick works fit here.', originX: 181, originZ: -327, cols: 6, rows: 6, cell: 8, tierBp: 10000, startRows: 2 },
      { id: 'baguida_est', nameFr: 'Baguida-Est', nameEn: 'East Baguida', descFr: 'Terrains à l’est, vers Baguida et la côte : en demande pour les entrepôts et les maisons de bord de mer.', descEn: 'Plots to the east towards Baguida and the coast: sought after for warehouses and seaside homes.', originX: 127, originZ: -222, cols: 7, rows: 2, cell: 8, tierBp: 12000 },
      { id: 'tokoin_nord', nameFr: 'Tokoin-Nord', nameEn: 'North Tokoin', descFr: 'Terrains le long du prolongement du boulevard Eyadéma, en bordure de route : bien placés, ils se vendent vite.', descEn: 'Plots along the Eyadéma boulevard extension, on the road: well placed, they sell fast.', originX: 16, originZ: -337, cols: 4, rows: 8, cell: 8, tierBp: 10000, startRows: 3 },
      { id: 'nord_ouest', nameFr: 'Nord-Ouest', nameEn: 'North-west', descFr: 'Une rangée de grands terrains à l’extrémité nord-ouest de la carte, très abordables.', descEn: 'A row of large plots at the north-west edge of the map, very affordable.', originX: -139, originZ: -467, cols: 9, rows: 1, cell: 8, tierBp: 10000 },
      { id: 'cite_ouest', nameFr: 'Cité-Ouest', nameEn: 'West estate', descFr: 'Petit lotissement à l’ouest, entre les routes d’Adidogomé et de la ville : calme et abordable.', descEn: 'Small estate in the west between the Adidogomé road and the city: quiet and affordable.', originX: -139, originZ: -267, cols: 5, rows: 2, cell: 8, tierBp: 10000 },
      { id: 'ville_ouest', nameFr: 'Ville – Ouest', nameEn: 'City – West', descFr: 'Parcelles rares en pleine ville, à l’ouest : cher au m², mais idéal pour une boutique ou une maison bien située.', descEn: 'Rare in-town plots in the west: pricey per m², but ideal for a shop or a well-located house.', originX: -141, originZ: -17, cols: 5, rows: 3, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_est', nameFr: 'Ville – Est', nameEn: 'City – East', descFr: 'Parcelles en ville à l’est, près de l’aéroport : une bonne adresse pour entrepôt ou logement.', descEn: 'In-town plots in the east near the airport: a good address for a warehouse or housing.', originX: 206, originZ: -17, cols: 4, rows: 3, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_sud_ouest', nameFr: 'Ville – Sud-Ouest', nameEn: 'City – South-west', descFr: 'Quelques lots libres entre les avenues, au sud-ouest : on construit ici un logement en ville.', descEn: 'A few free lots between the avenues in the south-west: build a home in town here.', originX: -141, originZ: -94, cols: 5, rows: 2, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_aeroport', nameFr: 'Ville – Aéroport', nameEn: 'City – Airport', descFr: 'Petite parcelle entre l’aéroport et le boulevard : passage important, idéale pour un commerce.', descEn: 'Small parcel between the airport and the boulevard: heavy traffic, ideal for a shop.', originX: 189, originZ: -82, cols: 2, rows: 3, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_kegue', nameFr: 'Ville – Kégué', nameEn: 'City – Kégué', descFr: 'Quelques lots au cœur du quartier de Kégué, proches des commodités.', descEn: 'A few lots in the heart of Kégué, close to amenities.', originX: 147, originZ: -18, cols: 2, rows: 2, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'legbassito', nameFr: 'Légbassito', nameEn: 'Légbassito', descFr: 'Quelques terrains à l’ouest, près de la route de Légbassito : calmes et abordables.', descEn: 'A few plots in the west near the Légbassito road: quiet and affordable.', originX: -104, originZ: -402, cols: 3, rows: 1, cell: 8, tierBp: 10000 },
      { id: 'dogta_ouest', nameFr: 'Dogta-Lafiè – Ouest', nameEn: 'Dogta-Lafiè – West', descFr: 'Deux rangées de lots juste à l’ouest de l’hôpital de Dogta-Lafiè, au bout de la route : peu chers, tranquilles.', descEn: 'Two rows of lots just west of the Dogta-Lafiè hospital at the end of the road: cheap and quiet.', originX: -55, originZ: -472, cols: 5, rows: 2, cell: 8, tierBp: 10_000, margin: 1, sign: false },
      { id: 'lafie_ouest', nameFr: 'Lafiè – Ouest', nameEn: 'Lafiè – West', descFr: 'Lots alignés à l’extrémité nord-ouest de la ville, près de la route de Légbassito.', descEn: 'Lots in a row at the north-west end of town, near the Légbassito road.', originX: -107, originZ: -449, cols: 6, rows: 2, cell: 8, tierBp: 10_000, margin: 1, sign: false },
      { id: 'legbassito_sud', nameFr: 'Légbassito – Sud', nameEn: 'Légbassito – South', descFr: 'Une petite bande de terrains au sud de Légbassito, entre la route et la lagune.', descEn: 'A small strip of plots south of Légbassito, between the road and the lagoon.', originX: -111, originZ: -384, cols: 2, rows: 4, cell: 8, tierBp: 10_000, margin: 1, sign: false },
      { id: 'route_ouest', nameFr: 'Route de l’Ouest', nameEn: 'West road', descFr: 'Une file de lots le long de la route qui mène vers l’ouest : bon emplacement pour une activité de bord de route.', descEn: 'A line of lots along the road heading west: a good spot for a roadside business.', originX: -70, originZ: -396, cols: 1, rows: 5, cell: 8, tierBp: 10_000, margin: 1, sign: false },
      { id: 'dogta_sud', nameFr: 'Dogta-Lafiè – Sud', nameEn: 'Dogta-Lafiè – South', descFr: 'Trois lots au sud de l’hôpital, à l’écart de la route : idéal pour une maison au calme.', descEn: 'Three lots south of the hospital, away from the road: ideal for a quiet home.', originX: 17, originZ: -354, cols: 3, rows: 1, cell: 8, tierBp: 10_000, margin: 1, sign: false },
      { id: 'ville_bord_est', nameFr: 'Ville – Bord Est', nameEn: 'City – East edge', descFr: 'Lots alignés le long de la limite est de la ville, au nord de l’aéroport.', descEn: 'Lots in a row along the east edge of the city, north of the airport.', originX: 230, originZ: -108, cols: 1, rows: 8, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_marche', nameFr: 'Ville – Marché', nameEn: 'City – Market', descFr: 'Une rangée de lots en ville, près du marché : un passage qui ne désemplit pas.', descEn: 'A row of in-town lots near the market: constant foot traffic.', originX: 146, originZ: -48, cols: 6, rows: 1, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'ville_nord_ouest', nameFr: 'Ville – Nord-Ouest', nameEn: 'City – North-west', descFr: 'Quatre lots à l’écart du centre, à l’ouest de la ville.', descEn: 'Four lots away from the centre, in the west of the city.', originX: -143, originZ: -57, cols: 2, rows: 2, cell: 8, tierBp: 10000, margin: 1, sign: false },
      { id: 'sogbossito', nameFr: 'Sogbossito', nameEn: 'Sogbossito', descFr: 'Quartier en pleine expansion au nord-ouest d’Agoè : parcelles familiales et petits commerces, prix encore doux.', descEn: 'Fast-growing area north-west of Agoè: family plots and small shops, prices still gentle.', originX: -205, originZ: -498, cols: 6, rows: 6, cell: 8, tierBp: 11000, startRows: 3 },
      { id: 'legbassito_ouest', nameFr: 'Légbassito – Ouest', nameEn: 'Légbassito – West', descFr: 'Grand Lomé, vers l’ouest : de grandes parcelles à bâtir le long de la route de Légbassito.', descEn: 'Greater Lomé, to the west: large building plots along the Légbassito road.', originX: -286, originZ: -488, cols: 6, rows: 6, cell: 8, tierBp: 9500, startRows: 3 },
      { id: 'axe_nord_est', nameFr: 'RN1 – Nord-Est', nameEn: 'N1 – North-East', descFr: 'Terres agricoles à l’est de la RN1, entre Agoè et Davié : champs, élevage et dépôts.', descEn: 'Farmland east of the N1 between Agoè and Davié: fields, livestock and depots.', originX: 20, originZ: -700, cols: 10, rows: 8, cell: 8, tierBp: 8000, startRows: 3 },
      { id: 'axe_nord_ouest', nameFr: 'RN1 – Nord-Ouest', nameEn: 'N1 – North-West', descFr: 'Terres à l’ouest de la RN1, entre Agoè et Davié, à quelques minutes de la route.', descEn: 'Land west of the N1 between Agoè and Davié, minutes from the road.', originX: -110, originZ: -600, cols: 8, rows: 6, cell: 8, tierBp: 8000, startRows: 3 },
      { id: 'davie_sud_est', nameFr: 'Davié – Péage', nameEn: 'Davié – Toll', descFr: 'Terrains entre le péage et le village de Davié : un passage obligé pour les camions et les voyageurs.', descEn: 'Plots between the toll and Davié village: a must-pass for trucks and travellers.', originX: 18, originZ: -880, cols: 6, rows: 3, cell: 8, tierBp: 12000 },
      { id: 'davie_nord_ouest', nameFr: 'Davié – Kpalimé', nameEn: 'Davié – Kpalimé', descFr: 'Terrains au nord du carrefour de la route de Kpalimé.', descEn: 'Plots north of the Kpalimé road junction.', originX: -80, originZ: -990, cols: 8, rows: 3, cell: 8, tierBp: 10000 },
      { id: 'tsevie_est', nameFr: 'Tsévié – Entrée sud', nameEn: 'Tsévié – South gate', descFr: 'Terrains à l’est de la RN1, avant l’entrée de Tsévié.', descEn: 'Plots east of the N1, before Tsévié’s entrance.', originX: 20, originZ: -990, cols: 8, rows: 4, cell: 8, tierBp: 10000, startRows: 2 },
      { id: 'tsevie_ouest', nameFr: 'Tsévié – Ouest', nameEn: 'Tsévié – West', descFr: 'Terrains à l’ouest de la RN1, aux portes de Tsévié.', descEn: 'Plots west of the N1 at the gates of Tsévié.', originX: -100, originZ: -1042, cols: 8, rows: 4, cell: 8, tierBp: 10000, startRows: 2 },
      { id: 'apessito', nameFr: 'Apessito', nameEn: 'Apessito', descFr: 'Sur la route de Mission-Tové, au nord de Légbassito : grandes parcelles calmes, avec église, école et poste de police à proximité.', descEn: 'On the Mission-Tové road, north of Légbassito: quiet large plots with a church, school and police post nearby.', originX: -286, originZ: -588, cols: 6, rows: 6, cell: 8, tierBp: 9500, startRows: 3 },
      { id: 'davie_sud_ouest', nameFr: 'Davié – Sud-Ouest', nameEn: 'Davié – South-West', descFr: 'Terrains à l’ouest de la RN1, entre le péage et le village de Davié.', descEn: 'Plots west of the N1, between the toll and Davié village.', originX: -90, originZ: -880, cols: 6, rows: 3, cell: 8, tierBp: 10500, startRows: 2 },
      { id: 'davie_est', nameFr: 'Davié – Est', nameEn: 'Davié – East', descFr: 'Grandes parcelles à l’est de Davié, au nord du carrefour de la route de Kpalimé.', descEn: 'Large plots east of Davié, north of the Kpalimé road junction.', originX: 60, originZ: -930, cols: 8, rows: 4, cell: 8, tierBp: 9500, startRows: 2 },
      { id: 'axe_milieu_est', nameFr: 'RN1 – Milieu Est', nameEn: 'N1 – Mid East', descFr: 'Terres agricoles à l’est de la RN1, à mi-chemin entre Agoè et Davié.', descEn: 'Farmland east of the N1, halfway between Agoè and Davié.', originX: 40, originZ: -790, cols: 8, rows: 4, cell: 8, tierBp: 8500, startRows: 2 },
      { id: 'axe_milieu_ouest', nameFr: 'RN1 – Milieu Ouest', nameEn: 'N1 – Mid West', descFr: 'Terres à l’ouest de la RN1, à mi-chemin entre Agoè et Davié.', descEn: 'Land west of the N1, halfway between Agoè and Davié.', originX: -110, originZ: -780, cols: 8, rows: 4, cell: 8, tierBp: 8500, startRows: 2 },
    ],
    steps: {
      SURVEYED: { feePerM2: 40, minFee: 15_000, gameHours: 48 },
      OPINION: { feePerM2: 60, minFee: 25_000, gameHours: 72 },
      TITLED: { feePerM2: 120, minFee: 50_000, gameHours: 120 },
    },
    uses: [
      // Maisons : de la case au petit immeuble ; chaque modèle relève d'une classe de logement (loyer, factures, intérieur)
      { id: 'house_case', kind: 'HOUSE', emoji: '🛖', nameFr: 'Case traditionnelle', nameEn: 'Traditional hut', model: 'ENTRER_COUCHER', style: 'hut', descFr: 'Murs en terre et toit de paille, à l’ancienne.', descEn: 'Earth walls and a thatched roof, the old way.', minM2: 150, cost: 900_000, costPerM2: 0, buildGameDays: 4, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_small', kind: 'HOUSE', emoji: '🏠', nameFr: 'Entrer-coucher', nameEn: 'One-room house', model: 'ENTRER_COUCHER', style: 'block', descFr: 'Pièce unique en parpaings, toit de tôle.', descEn: 'Single block-built room, tin roof.', minM2: 150, cost: 1_500_000, costPerM2: 0, buildGameDays: 5, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_studio', kind: 'HOUSE', emoji: '🏢', nameFr: 'Studio moderne', nameEn: 'Modern studio', model: 'ENTRER_COUCHER', style: 'studio', descFr: 'Petit cube moderne, toit-terrasse et grande baie.', descEn: 'Small modern cube with a roof terrace and a wide window.', minM2: 150, cost: 2_500_000, costPerM2: 0, buildGameDays: 7, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_medium', kind: 'HOUSE', emoji: '🏡', nameFr: 'Chambre-salon', nameEn: 'Two-room house', model: 'CHAMBRE_SALON', style: 'veranda', descFr: 'Maison de cour à véranda, toit de tôle à deux pans.', descEn: 'Courtyard house with a veranda and a gabled tin roof.', minM2: 300, cost: 4_000_000, costPerM2: 0, buildGameDays: 10, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_twobed', kind: 'HOUSE', emoji: '🏡', nameFr: 'Deux chambres-salon', nameEn: 'Two-bedroom house', model: 'CHAMBRE_SALON', style: 'twobed', descFr: 'Deux chambres et un salon, toit en tuiles, perron.', descEn: 'Two bedrooms and a lounge, tiled roof, front steps.', minM2: 300, cost: 6_000_000, costPerM2: 0, buildGameDays: 13, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_bungalow', kind: 'HOUSE', emoji: '🌴', nameFr: 'Bungalow à véranda', nameEn: 'Veranda bungalow', model: 'CHAMBRE_SALON', style: 'bungalow', descFr: 'Plain-pied entouré d’une véranda, large toit débordant.', descEn: 'Single storey wrapped in a veranda, wide overhanging roof.', minM2: 300, cost: 7_500_000, costPerM2: 0, buildGameDays: 15, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_villa_basse', kind: 'HOUSE', emoji: '🏘️', nameFr: 'Villa basse 3 chambres', nameEn: 'Three-bedroom bungalow villa', model: 'VILLA', style: 'villa_low', descFr: 'Villa de plain-pied, toit-terrasse, abri de voiture.', descEn: 'Single-storey villa, flat roof, carport.', minM2: 600, cost: 12_000_000, costPerM2: 0, buildGameDays: 20, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_duplex', kind: 'HOUSE', emoji: '🏙️', nameFr: 'Duplex (R+1)', nameEn: 'Duplex (two storeys)', model: 'VILLA', style: 'duplex', descFr: 'Deux niveaux, balcon filant et grandes baies vitrées.', descEn: 'Two storeys, a long balcony and large glass doors.', minM2: 600, cost: 18_000_000, costPerM2: 0, buildGameDays: 26, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_villa', kind: 'HOUSE', emoji: '🏰', nameFr: 'Villa à étage', nameEn: 'Two-storey villa', model: 'VILLA', style: 'villa', descFr: 'Colonnes, balcon, toit en tuiles à quatre pans.', descEn: 'Columns, balcony and a four-sided tiled roof.', minM2: 600, cost: 20_000_000, costPerM2: 0, buildGameDays: 28, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_villa_piscine', kind: 'HOUSE', emoji: '🏊', nameFr: 'Villa avec piscine', nameEn: 'Villa with pool', model: 'VILLA', style: 'villa_pool', descFr: 'Villa moderne, piscine, terrasse et palmiers.', descEn: 'Modern villa with a pool, a terrace and palm trees.', minM2: 600, cost: 35_000_000, costPerM2: 0, buildGameDays: 35, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'house_immeuble', kind: 'HOUSE', emoji: '🏬', nameFr: 'Petit immeuble (R+2)', nameEn: 'Small three-storey building', model: 'VILLA', style: 'immeuble', descFr: 'Trois niveaux avec balcons et château d’eau sur le toit.', descEn: 'Three storeys with balconies and a water tank on the roof.', minM2: 600, cost: 45_000_000, costPerM2: 0, buildGameDays: 42, dailyYieldBp: 0, lifeGameDays: 0 },
      { id: 'biz_garden', kind: 'BUSINESS', emoji: '🥬', nameFr: 'Maraîchage', nameEn: 'Market gardening', minM2: 300, cost: 0, costPerM2: 500, buildGameDays: 10, dailyYieldBp: 70, lifeGameDays: 300 },
      { id: 'biz_poultry', kind: 'BUSINESS', emoji: '🐔', nameFr: 'Élevage de volailles', nameEn: 'Poultry farm', minM2: 150, cost: 0, costPerM2: 900, buildGameDays: 14, dailyYieldBp: 90, lifeGameDays: 240 },
      { id: 'biz_bricks', kind: 'BUSINESS', emoji: '🧱', nameFr: 'Briqueterie (parpaings)', nameEn: 'Block-making yard', minM2: 300, cost: 0, costPerM2: 1_200, buildGameDays: 21, dailyYieldBp: 85, lifeGameDays: 300 },
      { id: 'biz_warehouse', kind: 'BUSINESS', emoji: '🏭', nameFr: 'Entrepôt à louer', nameEn: 'Rental warehouse', minM2: 600, cost: 0, costPerM2: 1_800, buildGameDays: 30, dailyYieldBp: 55, lifeGameDays: 480 },
      { id: 'biz_cement', kind: 'BUSINESS', emoji: '🏗️', nameFr: 'Cimenterie', nameEn: 'Cement plant', minM2: 1_200, cost: 0, costPerM2: 2_500, buildGameDays: 45, dailyYieldBp: 70, lifeGameDays: 360 },
      { id: 'biz_refinery', kind: 'BUSINESS', emoji: '🛢️', nameFr: 'Raffinerie de pétrole', nameEn: 'Oil refinery', minM2: 2_400, cost: 0, costPerM2: 5_000, buildGameDays: 90, dailyYieldBp: 75, lifeGameDays: 540 },
    ],
  },
  // Cases de pub (mer, est, lagunes) : louées à la semaine, comme les panneaux ; prix par lieu = produit `plot_<espace>`
  'ad.plots.period': { days: 7, counts: [1, 2, 4] },
  // Panneaux numérotés réservables dans la ville (0..count-1), mêmes emplacements que front/src/game/World.ts (buildBillboards, constante NUMBERED_BOARDS : à garder égale à ce nombre)
  'ad.boards': { count: 40 },
  'ad.rotation': { max: 8, panels: 10 },
  'ad.zones': [
    // Zone publicitaire hors de l'emprise urbaine et du corridor aéroport–Port.
    { id: 'east', slot: -3, cols: 16, rows: 80, cell: 4, originX: 254, originZ: -330, maxSide: 8 },
    { id: 'lac_ouest', slot: -4, cols: 6, rows: 3, cell: 4, originX: -76, originZ: -56, maxSide: 3 },
    { id: 'lac_est', slot: -5, cols: 4, rows: 2, cell: 4, originX: 125, originZ: -94, maxSide: 2 },
    // Deux bassins de rétention de Deux Lions (au nord du carrefour, de part et d'autre de la voie nord)
    { id: 'lac_lions_ouest', slot: -6, cols: 2, rows: 5, cell: 4, originX: -98, originZ: -341, maxSide: 2 },
    { id: 'lac_lions_est', slot: -7, cols: 2, rows: 3, cell: 4, originX: -70, originZ: -334, maxSide: 2 },
  ],
  'sea.plots': { cols: 72, rows: 36, cell: 4, originX: -200, originZ: 44, maxSide: 8, days: 30 },
  // Heures d'ouverture réelles (heures de jeu) ; [0, 24] = toujours ouvert, fermeture < ouverture = ouvert la nuit
  'venues.hours': {
    bceao: [8, 16], boad: [8, 17],
    marche_assigame: [0, 24], adidogome: [0, 24], akodessewa: [0, 24], monument: [0, 24], palais_congres: [0, 24], hotel_2fevrier: [0, 24], presidence: [0, 24], chu_campus: [0, 24], carrefour_gta: [0, 24], chr_commune: [0, 24], hopital_dogta: [0, 24], stade_kegue: [8, 22], echangeur_kegue: [0, 24], echangeur_agoe: [0, 24], carrefour_deux_lions: [0, 24], colombe_paix: [0, 24], marche_agoe: [0, 24], marche_hedzranawoe: [0, 24], moov_africa: [8, 18], carrefour_otr: [0, 24], bank_boa_1: [8, 16], bank_boa_2: [8, 16], bank_orabank_1: [8, 16], bank_orabank_2: [8, 16], bank_ecobank_1: [8, 16], bank_ecobank_2: [8, 16], bank_nsia_1: [8, 16], bank_nsia_2: [8, 16], bank_fucec_1: [8, 17], bank_fucec_4: [8, 17], bank_ibbank_1: [8, 16], palais_lome: [9, 18], yas: [8, 18], amb_usa: [8, 16], amb_chine: [8, 16], amb_france: [8, 16], amb_allemagne: [8, 16], amb_ghana: [8, 16], amb_nigeria: [8, 16], kiosque_momo: [7, 21],
    maquis_be: [11, 5], mode_assigame: [8, 20], mode_nyekonakpoe: [8, 20], mode_be: [8, 20], mode_adidogome: [8, 20], deckon: [0, 24], port: [7, 19], cnss: [8, 17], cfe: [8, 17], otr: [8, 17], universite: [7, 21],
    chu: [0, 24], aeroport: [0, 24], btp: [8, 17], agbalepedo: [4, 22], supermarche: [8, 22], epicerie: [6, 23], station_zem: [5, 23], plage_lome: [6, 20], boutique: [0, 24], studio_ori_infos: [8, 18], capture_media: [8, 18],
  },
  // Commerce au port de Lomé : importer pour revendre au marché, exporter les produits du pays.
  // Prix indicatifs du jeu, à équilibrer ; droits de douane et taxe à l'export reversés au Trésor.
  'port.goods': {
    swingBp: 600,
    remoteSpreadBp: 500,
    maxMarginBp: 3800,
    dailyDepthBp: 2500,
    dailyMinSell: 5,
    dailyMaxSell: 25,
    alertProfit: 300_000,
    goods: [
      { id: 'riz_sac', emoji: '🍚', nameFr: 'Sac de riz importé (25 kg)', nameEn: 'Imported rice bag (25 kg)', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_assigame', buyPrice: 9_000, sellPrice: 11_600, taxBp: 1000, maxQty: 100, respect: 0 },
      { id: 'poisson_carton', emoji: '🐟', nameFr: 'Carton de poisson congelé', nameEn: 'Carton of frozen fish', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_assigame', buyPrice: 12_000, sellPrice: 16_600, taxBp: 1000, maxQty: 60, respect: 0 },
      { id: 'friperie_balle', emoji: '👕', nameFr: 'Balle de friperie', nameEn: 'Bale of second-hand clothes', kind: 'IMPORT', buyAt: 'port', sellAt: 'adidogome', buyPrice: 35_000, sellPrice: 55_500, taxBp: 2000, maxQty: 30, respect: 0 },
      { id: 'wax_ballot', emoji: '🧵', nameFr: 'Ballot de pagnes wax', nameEn: 'Bundle of wax prints', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_assigame', buyPrice: 40_000, sellPrice: 62_400, taxBp: 2000, maxQty: 30, respect: 0 },
      { id: 'telephones', emoji: '📱', nameFr: 'Carton de téléphones', nameEn: 'Carton of phones', kind: 'IMPORT', buyAt: 'port', sellAt: 'deckon', buyPrice: 60_000, sellPrice: 87_900, taxBp: 2000, maxQty: 20, respect: 0 },
      { id: 'huile_bidon', emoji: '🛢️', nameFr: 'Bidon d’huile végétale (20 L)', nameEn: 'Vegetable oil drum (20 L)', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_hedzranawoe', buyPrice: 14_000, sellPrice: 18_100, taxBp: 1000, maxQty: 80, respect: 0 },
      { id: 'sucre_sac', emoji: '🍬', nameFr: 'Sac de sucre (50 kg)', nameEn: 'Sugar bag (50 kg)', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_agoe', buyPrice: 22_000, sellPrice: 28_100, taxBp: 1000, maxQty: 60, respect: 0 },
      { id: 'farine_sac', emoji: '🌾', nameFr: 'Sac de farine de blé (50 kg)', nameEn: 'Wheat flour bag (50 kg)', kind: 'IMPORT', buyAt: 'port', sellAt: 'adidogome', buyPrice: 19_000, sellPrice: 24_300, taxBp: 1000, maxQty: 60, respect: 0 },
      { id: 'lait_carton', emoji: '🥛', nameFr: 'Carton de lait en poudre', nameEn: 'Carton of powdered milk', kind: 'IMPORT', buyAt: 'port', sellAt: 'supermarche', buyPrice: 18_000, sellPrice: 23_400, taxBp: 1000, maxQty: 50, respect: 0 },
      { id: 'tomate_concentre', emoji: '🥫', nameFr: 'Carton de concentré de tomate', nameEn: 'Carton of tomato paste', kind: 'IMPORT', buyAt: 'port', sellAt: 'akodessewa', buyPrice: 9_500, sellPrice: 12_600, taxBp: 1000, maxQty: 80, respect: 0 },
      { id: 'pates_carton', emoji: '🍝', nameFr: 'Carton de spaghettis', nameEn: 'Carton of spaghetti', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_hedzranawoe', buyPrice: 8_000, sellPrice: 10_600, taxBp: 1000, maxQty: 80, respect: 0 },
      { id: 'savon_carton', emoji: '🧼', nameFr: 'Carton de savon', nameEn: 'Carton of soap', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_agoe', buyPrice: 7_000, sellPrice: 9_400, taxBp: 1000, maxQty: 80, respect: 0 },
      { id: 'ciment_sac', emoji: '🏗️', nameFr: 'Lot de 10 sacs de ciment', nameEn: 'Pack of 10 cement bags', kind: 'IMPORT', buyAt: 'port', sellAt: 'btp', buyPrice: 48_000, sellPrice: 58_000, taxBp: 500, maxQty: 40, respect: 0 },
      { id: 'fer_beton', emoji: '🔩', nameFr: 'Botte de fer à béton', nameEn: 'Bundle of rebar', kind: 'IMPORT', buyAt: 'port', sellAt: 'btp', buyPrice: 55_000, sellPrice: 67_000, taxBp: 500, maxQty: 30, respect: 0 },
      { id: 'pneus', emoji: '🛞', nameFr: 'Lot de pneus', nameEn: 'Set of tyres', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_hedzranawoe', buyPrice: 70_000, sellPrice: 98_300, taxBp: 1500, maxQty: 20, respect: 0 },
      { id: 'pieces_moto', emoji: '⚙️', nameFr: 'Carton de pièces de moto', nameEn: 'Carton of motorbike parts', kind: 'IMPORT', buyAt: 'port', sellAt: 'deckon', buyPrice: 30_000, sellPrice: 42_800, taxBp: 1500, maxQty: 30, respect: 0 },
      { id: 'motos', emoji: '🏍️', nameFr: 'Moto neuve (en caisse)', nameEn: 'New motorbike (crated)', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_agoe', buyPrice: 450_000, sellPrice: 621_000, taxBp: 1500, maxQty: 5, respect: 0 },
      { id: 'panneaux_solaires', emoji: '☀️', nameFr: 'Kit de panneaux solaires', nameEn: 'Solar panel kit', kind: 'IMPORT', buyAt: 'port', sellAt: 'deckon', buyPrice: 120_000, sellPrice: 148_700, taxBp: 500, maxQty: 10, respect: 0 },
      { id: 'electromenager', emoji: '📺', nameFr: 'Carton de téléviseurs', nameEn: 'Carton of TV sets', kind: 'IMPORT', buyAt: 'port', sellAt: 'deckon', buyPrice: 150_000, sellPrice: 216_000, taxBp: 2000, maxQty: 10, respect: 0 },
      { id: 'ordinateurs', emoji: '💻', nameFr: 'Carton d’ordinateurs portables', nameEn: 'Carton of laptops', kind: 'IMPORT', buyAt: 'port', sellAt: 'deckon', buyPrice: 380_000, sellPrice: 493_300, taxBp: 1000, maxQty: 5, respect: 0 },
      { id: 'cosmetiques', emoji: '💄', nameFr: 'Carton de cosmétiques', nameEn: 'Carton of cosmetics', kind: 'IMPORT', buyAt: 'port', sellAt: 'marche_assigame', buyPrice: 25_000, sellPrice: 40_200, taxBp: 2000, maxQty: 40, respect: 0 },
      { id: 'chaussures_lot', emoji: '👟', nameFr: 'Lot de chaussures', nameEn: 'Lot of shoes', kind: 'IMPORT', buyAt: 'port', sellAt: 'mode_be', buyPrice: 32_000, sellPrice: 50_000, taxBp: 2000, maxQty: 30, respect: 0 },
      { id: 'medicaments_gros', emoji: '💊', nameFr: 'Carton de produits pharmaceutiques (grossiste agréé)', nameEn: 'Carton of pharmacy goods (licensed wholesaler)', kind: 'IMPORT', buyAt: 'aeroport', sellAt: 'chu', buyPrice: 90_000, sellPrice: 107_800, taxBp: 500, maxQty: 10, respect: 0 },
      { id: 'noix_cajou', emoji: '🥜', nameFr: 'Sac de noix de cajou', nameEn: 'Bag of cashew nuts', kind: 'EXPORT', buyAt: 'adidogome', sellAt: 'port', buyPrice: 6_000, sellPrice: 8_000, taxBp: 300, maxQty: 100, respect: 0 },
      { id: 'soja_sac', emoji: '🫘', nameFr: 'Sac de soja', nameEn: 'Bag of soybeans', kind: 'EXPORT', buyAt: 'adidogome', sellAt: 'port', buyPrice: 8_000, sellPrice: 10_400, taxBp: 300, maxQty: 100, respect: 0 },
      { id: 'karite', emoji: '🧴', nameFr: 'Carton de beurre de karité', nameEn: 'Carton of shea butter', kind: 'EXPORT', buyAt: 'marche_assigame', sellAt: 'port', buyPrice: 5_000, sellPrice: 6_800, taxBp: 300, maxQty: 100, respect: 0 },
      { id: 'cafe_cacao', emoji: '☕', nameFr: 'Sac de café-cacao des Plateaux', nameEn: 'Sack of Plateaux coffee and cocoa', kind: 'EXPORT', buyAt: 'marche_assigame', sellAt: 'port', buyPrice: 15_000, sellPrice: 19_500, taxBp: 500, maxQty: 60, respect: 0 },
      { id: 'coton_balle', emoji: '☁️', nameFr: 'Balle de coton', nameEn: 'Bale of cotton', kind: 'EXPORT', buyAt: 'agbalepedo', sellAt: 'port', buyPrice: 20_000, sellPrice: 25_600, taxBp: 300, maxQty: 60, respect: 0 },
      { id: 'sesame_sac', emoji: '🌱', nameFr: 'Sac de sésame', nameEn: 'Bag of sesame', kind: 'EXPORT', buyAt: 'agbalepedo', sellAt: 'port', buyPrice: 11_000, sellPrice: 14_300, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'ananas_caisse', emoji: '🍍', nameFr: 'Caisse d’ananas', nameEn: 'Crate of pineapples', kind: 'EXPORT', buyAt: 'marche_agoe', sellAt: 'aeroport', buyPrice: 7_000, sellPrice: 9_400, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'gingembre_sac', emoji: '🫚', nameFr: 'Sac de gingembre', nameEn: 'Bag of ginger', kind: 'EXPORT', buyAt: 'marche_hedzranawoe', sellAt: 'port', buyPrice: 9_000, sellPrice: 11_900, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'teck_lot', emoji: '🪵', nameFr: 'Lot de bois de teck', nameEn: 'Lot of teak wood', kind: 'EXPORT', buyAt: 'agbalepedo', sellAt: 'port', buyPrice: 60_000, sellPrice: 78_000, taxBp: 500, maxQty: 20, respect: 0 },
      { id: 'artisanat', emoji: '🗿', nameFr: 'Caisse d’artisanat togolais', nameEn: 'Crate of Togolese crafts', kind: 'EXPORT', buyAt: 'akodessewa', sellAt: 'aeroport', buyPrice: 25_000, sellPrice: 34_000, taxBp: 300, maxQty: 30, respect: 0 },
      { id: 'mangues_greffees', emoji: '🥭', nameFr: 'Caisse de mangues greffées', nameEn: 'Crate of grafted mangoes', kind: 'EXPORT', buyAt: 'marche_agoe', sellAt: 'port', buyPrice: 8_000, sellPrice: 10_800, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'oranges_sac', emoji: '🍊', nameFr: 'Sac d’oranges', nameEn: 'Bag of oranges', kind: 'EXPORT', buyAt: 'marche_agoe', sellAt: 'port', buyPrice: 6_000, sellPrice: 8_100, taxBp: 300, maxQty: 100, respect: 0 },
      { id: 'avocats_caisse', emoji: '🥑', nameFr: 'Caisse d’avocats', nameEn: 'Crate of avocados', kind: 'EXPORT', buyAt: 'marche_hedzranawoe', sellAt: 'port', buyPrice: 9_000, sellPrice: 12_300, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'papayes_caisse', emoji: '🍈', nameFr: 'Caisse de papayes', nameEn: 'Crate of papayas', kind: 'EXPORT', buyAt: 'marche_agoe', sellAt: 'aeroport', buyPrice: 7_500, sellPrice: 10_200, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'noix_coco', emoji: '🥥', nameFr: 'Sac de noix de coco', nameEn: 'Bag of coconuts', kind: 'EXPORT', buyAt: 'plage_lome', sellAt: 'port', buyPrice: 5_000, sellPrice: 6_700, taxBp: 300, maxQty: 100, respect: 0 },
      { id: 'bananes_regime', emoji: '🍌', nameFr: 'Lot de régimes de bananes plantain', nameEn: 'Lot of plantain bunches', kind: 'EXPORT', buyAt: 'marche_hedzranawoe', sellAt: 'port', buyPrice: 9_000, sellPrice: 11_900, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'arachide_export', emoji: '🥜', nameFr: 'Sac d’arachides décortiquées (export)', nameEn: 'Bag of shelled groundnuts (export)', kind: 'EXPORT', buyAt: 'agbalepedo', sellAt: 'port', buyPrice: 13_000, sellPrice: 16_900, taxBp: 300, maxQty: 80, respect: 0 },
      { id: 'igname_sac', emoji: '🍠', nameFr: 'Sac d’ignames du Nord', nameEn: 'Bag of northern yams', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'marche_assigame', buyPrice: 12_000, sellPrice: 14_900, taxBp: 0, maxQty: 80, respect: 0 },
      { id: 'mais_sac', emoji: '🌽', nameFr: 'Sac de maïs', nameEn: 'Bag of maize', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'marche_agoe', buyPrice: 10_000, sellPrice: 12_400, taxBp: 0, maxQty: 100, respect: 0 },
      { id: 'haricot_sac', emoji: '🫘', nameFr: 'Sac de haricots', nameEn: 'Bag of beans', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'adidogome', buyPrice: 14_000, sellPrice: 17_700, taxBp: 0, maxQty: 80, respect: 0 },
      { id: 'arachide_sac', emoji: '🥜', nameFr: 'Sac d’arachides', nameEn: 'Bag of groundnuts', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'marche_hedzranawoe', buyPrice: 11_000, sellPrice: 13_900, taxBp: 0, maxQty: 80, respect: 0 },
      { id: 'charbon_sac', emoji: '⚫', nameFr: 'Sac de charbon de bois', nameEn: 'Bag of charcoal', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'akodessewa', buyPrice: 4_000, sellPrice: 5_200, taxBp: 0, maxQty: 100, respect: 0 },
      { id: 'poisson_fume', emoji: '🐠', nameFr: 'Panier de poisson fumé', nameEn: 'Basket of smoked fish', kind: 'LOCAL', buyAt: 'plage_lome', sellAt: 'adidogome', buyPrice: 8_000, sellPrice: 10_600, taxBp: 0, maxQty: 60, respect: 0 },
      { id: 'gari_sac', emoji: '🥣', nameFr: 'Sac de gari', nameEn: 'Bag of gari', kind: 'LOCAL', buyAt: 'marche_agoe', sellAt: 'marche_assigame', buyPrice: 7_000, sellPrice: 8_900, taxBp: 0, maxQty: 100, respect: 0 },
      { id: 'piment_sac', emoji: '🌶️', nameFr: 'Sac de piment séché', nameEn: 'Bag of dried chili', kind: 'LOCAL', buyAt: 'marche_hedzranawoe', sellAt: 'marche_agoe', buyPrice: 6_000, sellPrice: 7_800, taxBp: 0, maxQty: 80, respect: 0 },
      { id: 'sodabi_bidon', emoji: '🍶', nameFr: 'Bidon de sodabi', nameEn: 'Drum of sodabi', kind: 'LOCAL', buyAt: 'akodessewa', sellAt: 'maquis_be', buyPrice: 9_000, sellPrice: 12_300, taxBp: 0, maxQty: 40, respect: 0 },
      { id: 'bissap_sac', emoji: '🌺', nameFr: 'Sac de fleurs de bissap', nameEn: 'Bag of hibiscus flowers', kind: 'LOCAL', buyAt: 'agbalepedo', sellAt: 'supermarche', buyPrice: 5_000, sellPrice: 6_600, taxBp: 0, maxQty: 80, respect: 0 },
      { id: 'credit_mobile', emoji: '📶', nameFr: 'Lot de cartes de recharge', nameEn: 'Batch of airtime vouchers', kind: 'LOCAL', buyAt: 'yas', sellAt: 'kiosque_momo', buyPrice: 50_000, sellPrice: 57_100, taxBp: 0, maxQty: 30, respect: 0 },
      { id: 'voiture_occasion', emoji: '🚗', nameFr: 'Voiture d’occasion (venue d’Europe)', nameEn: 'Used car (shipped from Europe)', kind: 'CAR', buyAt: 'port', sellAt: 'deckon', buyPrice: 900_000, sellPrice: 1_350_000, taxBp: 2500, maxQty: 1, respect: 10 },
    ],
  },
  // Contenu des formules du modèle économique ; prix mensuels indicatifs (contrat facturé hors jeu)
  // Espaces verts libres au bord des routes (notamment entre le carrefour OTR et le rond-point GTA)
  'partners.spots': [...BASE_PARTNER_SPOTS, ...moreBusinessSpots(BASE_PARTNER_SPOTS), ...EAST_GOLD_SPOTS, ...LOME2_GOLD_SPOTS, ...EAST_BRONZE_SPOTS, ...BUSINESS_BRONZE_SPOTS],
  'partners.services': {
    clinic: { emoji: '🏥', app: null, jobs: ['infirmier', 'preparateur_pharma'], activities: [
      svc('🩺', 'Consultation', 'Consultation', 2_000, { health: 20 }),
      svc('🦟', 'Test de paludisme', 'Malaria test', 1_000, { health: 10 }),
      svc('🩹', 'Soins infirmiers', 'Nursing care', 3_000, { health: 30, energy: -5 }),
      svc('💉', 'Vaccin', 'Vaccine', 2_500, { health: 12 }),
      svc('🩸', 'Analyse de sang', 'Blood test', 4_000, { health: 8 }),
      svc('💊', 'Vitamines et fer', 'Vitamins and iron', 1_500, { health: 6, energy: 8 }),
      svc('🧴', 'Pansement et désinfectant', 'Dressing and disinfectant', 800, { health: 4, hygiene: 4 }),
      svc('💧', 'Perfusion de réhydratation', 'Rehydration drip', 5_000, { health: 18, energy: 15 }),
    ] },
    restaurant: { emoji: '🍽️', app: 'eat', jobs: ['maquis_waiter'], activities: [
      svc('🍛', 'Plat du jour', 'Dish of the day', 1_000, { hunger: 40, morale: 4 }),
      svc('🐟', 'Poisson grillé et ablo', 'Grilled fish and ablo', 1_500, { hunger: 45, morale: 5 }),
      svc('🍢', 'Brochettes', 'Skewers', 700, { hunger: 25, morale: 3 }),
      svc('🍗', 'Poulet braisé et alloco', 'Grilled chicken and alloco', 1_800, { hunger: 48, morale: 5 }),
      svc('🥗', 'Salade composée', 'Mixed salad', 900, { hunger: 18, health: 2 }),
      svc('🥤', 'Boisson fraîche', 'Cold drink', 300, { hunger: 2, morale: 3 }),
      svc('🧃', 'Jus naturel', 'Fresh juice', 500, { hunger: 4, health: 1, morale: 3 }),
      svc('🍮', 'Dessert', 'Dessert', 600, { hunger: 8, morale: 5 }),
    ] },
    shop: { emoji: '🛍️', app: null, jobs: ['shop_clerk', 'vendeur_mode'], activities: [
      svc('💧', 'Eau minérale 1,5 L', 'Mineral water 1.5 L', 400, { health: 1, morale: 1 }),
      svc('🧃', 'Biscuits et jus', 'Biscuits and juice', 600, { hunger: 18, morale: 2 }),
      svc('🍞', 'Pain et beurre', 'Bread and butter', 500, { hunger: 22 }),
      svc('🧼', 'Savon et dentifrice', 'Soap and toothpaste', 800, { hygiene: 20, morale: 1 }),
      svc('💊', 'Médicaments sans ordonnance', 'Over-the-counter medicine', 1_200, { health: 8 }),
      svc('🔋', 'Piles et lampe de poche', 'Batteries and torch', 1_500, { morale: 2 }),
      svc('💐', 'Parfum', 'Perfume', 3_500, { hygiene: 3, morale: 6, respect: 2 }),
      svc('🛍️', 'Faire du shopping', 'Go shopping', 2_500, { energy: -3, morale: 8, respect: 1 }),
    ] },
    hotel: { emoji: '🏨', app: null, jobs: ['hotel_waiter', 'receptionniste'], activities: [
      svc('🛏️', 'Chambre : se reposer', 'Room: rest', 6_000, { energy: 45, hygiene: 10, health: 3, morale: 4 }),
      svc('🥐', 'Petit-déjeuner', 'Breakfast', 2_000, { hunger: 30, morale: 4 }),
      svc('🍽️', 'Déjeuner buffet', 'Lunch buffet', 4_500, { hunger: 55, morale: 6 }),
      svc('🏊', 'Piscine', 'Swimming pool', 1_500, { energy: -5, hygiene: 5, morale: 8 }),
      svc('💆', 'Massage', 'Massage', 8_000, { energy: 20, health: 4, morale: 12 }),
      svc('🛎️', 'Room service', 'Room service', 3_000, { hunger: 28, morale: 5 }),
      svc('🍹', 'Cocktail au bar', 'Cocktail at the bar', 2_500, { morale: 9, health: -1 }),
    ] },
    station: { emoji: '⛽', app: 'garage', jobs: ['car_washer', 'agent_securite'], activities: [
      svc('🥤', 'Boisson fraîche', 'Cold drink', 300, { hunger: 2, morale: 3 }),
      svc('🥪', 'Sandwich', 'Sandwich', 800, { hunger: 20, morale: 1 }),
      svc('☕', 'Café', 'Coffee', 400, { energy: 6, morale: 2 }),
      svc('🍪', 'Biscuits', 'Biscuits', 350, { hunger: 10, morale: 1 }),
      svc('💧', 'Eau fraîche', 'Cold water', 250, { morale: 1 }),
      svc('🍦', 'Glace', 'Ice cream', 500, { hunger: 4, morale: 5 }),
    ] },
    transport: { emoji: '🛵', app: 'work', jobs: ['delivery_driver', 'cargo_rider', 'agent_securite'], activities: [
      svc('🥤', 'Boisson du chauffeur', 'Driver’s drink', 300, { morale: 3 }),
      svc('🥪', 'Casse-croûte', 'Snack', 700, { hunger: 18 }),
    ] },
    tower: { emoji: '🏢', app: 'work', jobs: ['secretaire_direction', 'agent_commercial', 'technicien_info'], activities: [
      svc('☕', 'Café de la cafétéria', 'Cafeteria coffee', 400, { energy: 6, morale: 2 }),
      svc('🥪', 'Sandwich de la cafétéria', 'Cafeteria sandwich', 900, { hunger: 22 }),
    ] },
    agency: { emoji: '🏦', app: 'bank', jobs: ['aide_comptable', 'assistant_financier', 'accountant'], activities: [] },
  },
  'partners.tiers': {
    BRONZE: { boards: 0, rotating: 1, brandPlace: true, jobs: 0, eventsPerMonth: 0, monthlyPrice: 10_000, defaultMonths: 12, minMonths: 1, maxMonths: 36 },
    SILVER: { boards: 2, rotating: 1, brandPlace: true, jobs: 0, eventsPerMonth: 1, monthlyPrice: 20_000, defaultMonths: 12, minMonths: 1, maxMonths: 36 },
    GOLD: { boards: 4, rotating: 2, brandPlace: true, jobs: 0, eventsPerMonth: 2, monthlyPrice: 35_000, defaultMonths: 12, minMonths: 1, maxMonths: 36 },
  },
  // Section « Nos partenaires » de la page Annonces : cachée tant que l'équipe ne l'affiche pas
  'partners.showcase': { show: false },
  // Compte supprimé : identité (nom, téléphone, e-mail, IP…) gardée pour l'administration, puis effacée après ce délai
  'account.deletedRetention': { days: 365 },
  'partners.contact': { email: 'dtdev.tg@gmail.com', whatsapp: '' },
  // Maison des joueurs (avec son espace vert) : îlot résidentiel entre les rues z -230 et z -190, vers Tokoin / Adidogomé.
  // Emplacement vérifié dans le moteur : 27 × 24 m entièrement hors chaussée, hors lieux, hors terrains à vendre et hors lagune.
  'home.position': { VILLA: { x: -102, z: -209 }, CHAMBRE_SALON: { x: -102, z: -209 }, ENTRER_COUCHER: { x: -102, z: -209 } },
  'transport.modes': {
    WALK: { base: 0, perKm: 0, roundTo: 1, energyPerKm: 4, riskBp: 0 },
    ZEM: { base: 100, perKm: 75, roundTo: 50, energyPerKm: 0, riskBp: 150 },
    WORO: { base: 150, perKm: 40, roundTo: 50, energyPerKm: 0, riskBp: 30 },
    BUS: { base: 150, perKm: 0, roundTo: 25, energyPerKm: 0, riskBp: 0 },
    // Véhicule personnel : pas de tarif, le carburant et l'entretien (réglages vehicles.catalog) sont à ta charge
    CAR: { base: 0, perKm: 0, roundTo: 1, energyPerKm: 0, riskBp: 20 },
    MOTO: { base: 0, perKm: 0, roundTo: 1, energyPerKm: 1, riskBp: 40 },
  },
};

const CACHE_TTL_MS = 15_000;

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  isKey(key: string): key is SettingKey {
    return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key);
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as SettingValue<K>;
    const row = await this.prisma.gameSetting.findUnique({ where: { key } });
    let value: SettingValue<K> = SETTING_DEFAULTS[key];
    if (row) {
      const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
      // Une valeur corrompue en base ne doit pas casser le jeu : on retombe sur la valeur par défaut.
      if (parsed.success) value = parsed.data as SettingValue<K>;
    }
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async all(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_SCHEMAS) as SettingKey[]) out[key] = await this.get(key);
    return out;
  }

  async set(key: string, raw: unknown, actorId: string): Promise<unknown> {
    if (!this.isKey(key)) throw new NotFoundException('unknown_setting');
    const parsed = SETTING_SCHEMAS[key].safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    const value = parsed.data as Prisma.InputJsonValue;
    await this.prisma.gameSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: actorId },
      update: { value, updatedBy: actorId },
    });
    this.cache.delete(key);
    return parsed.data;
  }

  async clock(): Promise<ClockConfig> {
    return this.get('game.clock');
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
