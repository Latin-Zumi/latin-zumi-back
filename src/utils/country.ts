export const PAISES = ['Argentina', 'Colombia', 'Otro'] as const;
export type Pais = (typeof PAISES)[number];

const CURRENCY_BY_COUNTRY: Record<Pais, string> = {
  Argentina: 'ARS',
  Colombia: 'COP',
  Otro: 'USD',
};

export function currencyForCountry(pais: Pais): string {
  return CURRENCY_BY_COUNTRY[pais];
}
