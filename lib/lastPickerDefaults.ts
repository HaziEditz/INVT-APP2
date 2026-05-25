import { getData, storeData } from './storage';
import type { PaymentType } from '@/context/DriverContext';

const TARIFF_KEY  = 'taxi360.lastTariffId.v1';
const PAYMENT_KEY = 'taxi360.lastPaymentType.v1';

const REMEMBERABLE_PAYMENT: PaymentType[] = ['cash', 'eftpos', 'card', 'gift_card'];

export async function getLastTariffId(): Promise<string | null> {
  return await getData<string>(TARIFF_KEY);
}

export async function saveLastTariffId(id: string | undefined | null): Promise<void> {
  if (!id) return;
  await storeData(TARIFF_KEY, id);
}

export async function getLastPaymentType(fallback: PaymentType = 'cash'): Promise<PaymentType> {
  const v = await getData<string>(PAYMENT_KEY);
  if (v && (REMEMBERABLE_PAYMENT as string[]).includes(v)) return v as PaymentType;
  return fallback;
}

export async function saveLastPaymentType(type: PaymentType | undefined | null): Promise<void> {
  if (!type) return;
  if (!(REMEMBERABLE_PAYMENT as string[]).includes(type)) return;
  await storeData(PAYMENT_KEY, type);
}
