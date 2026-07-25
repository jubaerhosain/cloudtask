import { SetMetadata } from '@nestjs/common';

import { IS_PUBLIC_KEY } from '../constants';

/** Marks a route as public so the global JWT guard skips it. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
