import { eq, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { counterSchema } from '@/models/Schema';

export const CurrentCount = async () => {
  const t = await getTranslations('CurrentCount');

  // `x-e2e-random-id` is used for end-to-end testing to make isolated requests
  // The default value is 0 when there is no `x-e2e-random-id` header
  const headersList = await headers();
  const id = Number(headersList.get('x-e2e-random-id')) || 0;
  // Use COALESCE(MAX(...), 0) to always return one row — Spin PG WIT binding
  // hangs on empty SELECT result sets (0 rows), so an aggregate avoids that.
  const [result] = await db
    .select({ count: sql<number>`COALESCE(MAX(${counterSchema.count}), 0)` })
    .from(counterSchema)
    .where(eq(counterSchema.id, id));
  const count = result?.count ?? 0;

  logger.info('Counter fetched successfully');

  return (
    <div>
      {t('count')} {count}
    </div>
  );
};
