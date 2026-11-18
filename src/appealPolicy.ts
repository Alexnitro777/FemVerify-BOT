import { Appeal } from './types';

export const APPEAL_DENY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const APPEAL_LIMIT_PER_TYPE = 2;

export type BlacklistType = 'ЧСП' | 'ЧСЗ' | 'ЧСА';

export function isBlacklistType(value: string): value is BlacklistType {
  return value === 'ЧСП' || value === 'ЧСЗ' || value === 'ЧСА';
}

export function appealSubmissionError(
  appeals: Appeal[],
  type: BlacklistType,
  now = Date.now(),
): string | null {
  const matching = appeals
    .filter((appeal) => (appeal.blacklistType ?? 'ЧСП') === type)
    .sort((a, b) => b.submittedAt - a.submittedAt || b.id - a.id);
  if (matching.some((appeal) => appeal.status === 'pending')) {
    return 'Ваша апелляция на этот тип блокировки уже на рассмотрении.';
  }
  if (matching.length >= APPEAL_LIMIT_PER_TYPE) {
    return `🚫 Вы исчерпали лимит подачи апелляций для данного типа блокировки (максимум ${APPEAL_LIMIT_PER_TYPE}).`;
  }
  const latest = matching[0];
  if (latest?.status === 'denied' && latest.resolvedAt !== undefined) {
    const availableAt = latest.resolvedAt + APPEAL_DENY_COOLDOWN_MS;
    if (now < availableAt) {
      const ts = Math.floor(availableAt / 1000);
      return `⛔ Вашу прошлую апелляцию отклонили. Новую можно подать <t:${ts}:R> (<t:${ts}:f>).`;
    }
  }
  return null;
}
