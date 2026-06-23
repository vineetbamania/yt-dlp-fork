import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks an endpoint as unauthenticated. Used for platform-level
 *  health checks (e.g. Render's polling /healthz) where requiring
 *  the bearer would cause the platform to mark the service unhealthy.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
