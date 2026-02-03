/**
 * Schedule-related constants and utilities for type-safe slot kind handling
 */

import { logger } from '@/lib/logger'

export type SlotKind = 'study' | 'focused_work' | 'light_work';

export const slotKindLabels: Record<SlotKind, string> = {
  study: '学習',
  focused_work: '集中作業',
  light_work: '軽作業',
} as const;

export const slotKindColors: Record<SlotKind, string> = {
  study: 'bg-blue-100 text-blue-800',
  focused_work: 'bg-purple-100 text-purple-800',
  light_work: 'bg-green-100 text-green-800',
} as const;

/**
 * Type-safe getter for slot kind labels with fallback and error logging
 * @param slotKind - The slot kind string from API response
 * @returns The corresponding Japanese label
 */
export const getSlotKindLabel = (slotKind: string): string => {
  const typedSlotKind = slotKind as SlotKind;

  if (!(slotKind in slotKindLabels)) {
    logger.warn('Unknown slot kind, using fallback to light_work', { slotKind }, { component: 'schedule' });
    return slotKindLabels.light_work;
  }

  return slotKindLabels[typedSlotKind];
};

/**
 * Type-safe getter for slot kind colors with fallback and error logging
 * @param slotKind - The slot kind string from API response
 * @returns The corresponding CSS classes
 */
export const getSlotKindColor = (slotKind: string): string => {
  const typedSlotKind = slotKind as SlotKind;

  if (!(slotKind in slotKindColors)) {
    logger.warn('Unknown slot kind, using fallback to light_work', { slotKind }, { component: 'schedule' });
    return slotKindColors.light_work;
  }

  return slotKindColors[typedSlotKind];
};

/**
 * Validates if a string is a valid SlotKind
 * @param value - The value to check
 * @returns True if the value is a valid SlotKind
 */
export const isValidSlotKind = (value: string): value is SlotKind => {
  return value in slotKindLabels;
};

/**
 * Day of week labels (0=Monday, 6=Sunday, following ISO 8601)
 */
export const dayOfWeekLabels: Record<number, string> = {
  0: '月曜日',
  1: '火曜日',
  2: '水曜日',
  3: '木曜日',
  4: '金曜日',
  5: '土曜日',
  6: '日曜日',
} as const;

export const dayOfWeekShortLabels: Record<number, string> = {
  0: '月',
  1: '火',
  2: '水',
  3: '木',
  4: '金',
  5: '土',
  6: '日',
} as const;

/**
 * Get the day of week label
 * @param dayOfWeek - Day index (0=Monday, 6=Sunday)
 * @returns The Japanese label for the day
 */
export const getDayOfWeekLabel = (dayOfWeek: number): string => {
  return dayOfWeekLabels[dayOfWeek] || '不明';
};

/**
 * Get the short day of week label
 * @param dayOfWeek - Day index (0=Monday, 6=Sunday)
 * @returns The short Japanese label for the day
 */
export const getDayOfWeekShortLabel = (dayOfWeek: number): string => {
  return dayOfWeekShortLabels[dayOfWeek] || '?';
};
