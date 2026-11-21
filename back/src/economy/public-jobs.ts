// Emplois salariés des employeurs publics : un par métier du catalogue, salaire dérivé du gain par service (pur, sans base).
export interface Band {
  min: number;
  max: number;
}

export interface JobLite {
  id: string;
  level: string;
  payPerShift: number;
}

/** Salaire brut mensuel d'un métier : réparti dans la bande de son niveau selon son gain par service, arrondi à 500 F. */
export function publicGross(job: JobLite, all: JobLite[], band: Band): number {
  const same = all.filter((j) => j.level === job.level);
  const lo = Math.min(...same.map((j) => j.payPerShift));
  const hi = Math.max(...same.map((j) => j.payPerShift));
  const t = hi > lo ? (job.payPerShift - lo) / (hi - lo) : 0;
  const raw = band.min + t * (band.max - band.min);
  return Math.min(band.max, Math.max(band.min, Math.round(raw / 500) * 500));
}

export type PayMode = 'TASK' | 'MONTHLY';

/**
 * Mode de paiement d'un métier : « TASK » (payé à chaque service, tout de suite) ou « MONTHLY » (salarié : embauche, puis salaire versé
 * chaque mois selon les services faits). Les métiers listés dans `taskPaid` sont à la tâche ; sans employeur public, tout est à la tâche.
 */
export function payModeOf(jobId: string, publicEnabled: boolean, taskPaid: readonly string[]): PayMode {
  return publicEnabled && !taskPaid.includes(jobId) ? 'MONTHLY' : 'TASK';
}

/** Part du salaire due pour un mois : proportionnelle aux services faits (plafonnée à 100 %). */
export function attendanceBp(done: number, required: number): number {
  if (required <= 0) return 10_000;
  return Math.min(10_000, Math.floor((Math.max(0, done) * 10_000) / required));
}
