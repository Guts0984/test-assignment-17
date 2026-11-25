export const formatMoney = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);

export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

export const formatInstant = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
