import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { clearSession, readToken } from '../lib';

const auth: Middleware = {
  onRequest: ({ request }) => {
    const token = readToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
};

/** A token the server rejects (signed out elsewhere, account removed) ends the session: the screens send the user to the login. */
const expired: Middleware = {
  onResponse: ({ response, request }) => {
    if (response.status === 401 && request.headers.has('Authorization')) clearSession();
    return response;
  },
};

/** Typed client generated from the API's OpenAPI document. Same origin: nginx routes /api to the api copies. */
export const api = createClient<paths>({ baseUrl: '' });
api.use(auth);
api.use(expired);

interface FetchResult<T> {
  readonly data?: T;
  readonly error?: unknown;
}

/** Turns an openapi-fetch result into a value, or throws the API error body ({ code, message, details }). */
export const call = async <T>(result: Promise<FetchResult<T>>): Promise<T> => {
  const { data, error } = await result;
  if (error !== undefined || data === undefined) throw error ?? { code: 'INTERNAL', message: 'Empty response' };
  return data;
};
