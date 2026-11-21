import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../common/audit.service';
import { PaymentsService } from './payments.service';
import type { PaymentProvider } from './payment-provider';
import type { Env } from '../config/env';

// Paiement tardif : un PAID signé reçu après un FAILED est crédité une seule fois (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Paiement tardif (PostgreSQL)', () => {
  let prisma: PrismaService;
  let svc: PaymentsService;
  let wallet: string;
  let purchase: string;
  const ref = `late-${Date.now().toString(36)}`;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    // Fournisseur de test : la signature est supposée vérifiée en amont, pas de vérification de statut à distance
    const provider = { name: 'test' } as unknown as PaymentProvider;
    svc = new PaymentsService(prisma, ledger, new AuditService(prisma), provider, {} as Env);
    await prisma.wallet.upsert({ where: { systemCode: 'PURCHASES' }, create: { systemCode: 'PURCHASES' }, update: {} });
    await prisma.product.upsert({ where: { id: 'test_pack' }, create: { id: 'test_pack', kind: 'COINS', nameFr: 'Pack test', nameEn: 'Test pack', priceAmount: 1_000, coinsGranted: 5_000 }, update: {} });
    const acc = await prisma.account.create({ data: { email: `${ref}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({ data: { accountId: acc.id, name: 'Acheteur', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } }, include: { wallet: true } });
    wallet = c.wallet!.id;
    purchase = (await prisma.purchase.create({ data: { accountId: acc.id, productId: 'test_pack', amount: 1_000, currency: 'XOF', coinsGranted: 5_000, provider: 'test', providerRef: ref } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('FAILED puis PAID : crédité une fois ; un FAILED tardif ne défait rien', async () => {
    const ev = (eventId: string, status: 'PAID' | 'FAILED') => ({ eventId: `${ref}-${eventId}`, providerRef: ref, status, amount: 1_000, currency: 'XOF' });
    await svc.applyEvent(ev('1', 'FAILED'));
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase } })).status).toBe('FAILED');
    await svc.applyEvent(ev('2', 'PAID'));
    expect(await bal()).toBe(5_000n);
    await svc.applyEvent(ev('3', 'PAID'));
    await svc.applyEvent(ev('4', 'FAILED'));
    expect(await bal()).toBe(5_000n);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase } })).status).toBe('PAID');
    expect(await prisma.auditLog.count({ where: { action: 'payment.late_paid', target: purchase } })).toBe(1);
  });
});
