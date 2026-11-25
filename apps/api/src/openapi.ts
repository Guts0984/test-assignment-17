import type { OpenAPIObject } from '@nestjs/swagger';
import { ERROR_CODES } from '@hotel/shared';

const ERROR_REF = { $ref: '#/components/schemas/ErrorResponse' };

/** Declares the single error format on every operation. */
export const describeApi = (doc: OpenAPIObject): OpenAPIObject => {
  const schemas = {
    ...(doc.components?.schemas ?? {}),
    ErrorResponse: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string', enum: [...ERROR_CODES] }, message: { type: 'string' }, details: {} },
    },
  } as NonNullable<OpenAPIObject['components']>['schemas'];
  const paths = Object.fromEntries(
    Object.entries(doc.paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, op]) => {
          if (typeof op !== 'object' || op === null || !('responses' in op)) return [method, op];
          const responses = { ...(op.responses as Record<string, unknown>), default: { description: 'Error', content: { 'application/json': { schema: ERROR_REF } } } };
          return [method, { ...op, responses }];
        }),
      ),
    ]),
  );
  return { ...doc, paths, components: { ...doc.components, schemas } };
};
