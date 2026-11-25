import { useSearchParams } from 'next/navigation';

/** The current URL's query string; never null (Next types it as nullable outside the App Router). */
export const useUrlParams = (): URLSearchParams => new URLSearchParams(useSearchParams()?.toString() ?? '');
