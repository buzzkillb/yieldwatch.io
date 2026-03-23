import { pgTable, serial, date, varchar, decimal, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const yieldCurveRates = pgTable('yield_curve_rates', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  maturity: varchar('maturity', { length: 10 }).notNull(),
  rate: decimal('rate', { precision: 8, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_rates_date_maturity').on(table.date, table.maturity),
  index('idx_rates_date').on(table.date),
  index('idx_rates_maturity').on(table.maturity),
]);

export const rateStats = pgTable('rate_stats', {
  id: serial('id').primaryKey(),
  maturity: varchar('maturity', { length: 10 }).notNull().unique(),
  yearHigh: decimal('year_high', { precision: 8, scale: 4 }),
  yearHighDate: date('year_high_date'),
  yearLow: decimal('year_low', { precision: 8, scale: 4 }),
  yearLowDate: date('year_low_date'),
  allTimeHigh: decimal('all_time_high', { precision: 8, scale: 4 }),
  allTimeHighDate: date('all_time_high_date'),
  allTimeLow: decimal('all_time_low', { precision: 8, scale: 4 }),
  allTimeLowDate: date('all_time_low_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type YieldCurveRate = typeof yieldCurveRates.$inferSelect;
export type NewYieldCurveRate = typeof yieldCurveRates.$inferInsert;
export type RateStat = typeof rateStats.$inferSelect;
