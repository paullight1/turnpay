import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import {
  AUTH_MUTATION_IDEMPOTENCY_POLICIES,
  getAuthMutationIdempotencyPolicy,
} from '../common/interceptors/idempotency.interceptor';

describe('Auth mutation idempotency policy coverage', () => {
  const methodNames: Partial<Record<RequestMethod, string>> = {
    [RequestMethod.POST]: 'POST',
    [RequestMethod.PATCH]: 'PATCH',
    [RequestMethod.DELETE]: 'DELETE',
    [RequestMethod.PUT]: 'PUT',
  };

  it('classifies every POST, PATCH, PUT, and DELETE route on AuthController', () => {
    const controllerPath = Reflect.getMetadata(
      PATH_METADATA,
      AuthController,
    ) as string;
    const uncovered: string[] = [];

    for (const name of Object.getOwnPropertyNames(AuthController.prototype)) {
      if (name === 'constructor') continue;
      const handler = AuthController.prototype[
        name as keyof AuthController
      ] as unknown as object;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      const method =
        requestMethod === undefined ? undefined : methodNames[requestMethod];
      if (!method) continue;

      const routePath = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | undefined;
      const normalizedRoute = routePath?.replace(':sessionId', 'test-session');
      const path = `/api/${controllerPath}${normalizedRoute ? `/${normalizedRoute}` : ''}`;
      if (!getAuthMutationIdempotencyPolicy(method, path)) {
        uncovered.push(`${method} ${path}`);
      }
    }

    expect(uncovered).toEqual([]);
  });

  it('encrypts only the auth routes that can return bearer or refresh tokens', () => {
    const encrypted = Object.entries(AUTH_MUTATION_IDEMPOTENCY_POLICIES)
      .filter(([, policy]) => policy === 'ENCRYPTED')
      .map(([route]) => route)
      .sort();

    expect(encrypted).toEqual([
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'POST /api/auth/register',
    ]);
  });
});
