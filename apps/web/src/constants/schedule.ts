/**
 * Schedule-related constants and utilities for type-safe slot kind handling
 */

import { logger } from '@/lib/logger'

export type SlotKind = 'study' | 'focused_work' | 'light_work' | 'meeting';

export const slotKindLabels: Record<SlotKind, string> = {
  study: '学習',
  focused_work: '集中作業',
  light_work: '軽作業',
  meeting: '会議',
} as const;

export const slotKindColors: Record<SlotKind, string> = {
  study: 'bg-blue-100 text-blue-800',
  focused_work: 'bg-purple-100 text-purple-800',
  light_work: 'bg-green-100 text-green-800',
  meeting: 'bg-orange-100 text-orange-800',
} as const;

/**
 * Type-safe getter for slot kind labels with fallback and error logging
 * @param slotKind - The slot kind string from API response
 * @returns The corresponding Japanese label
 */
export const getSlotKindLabel = (slotKind: string): string => {
  const typedSlotKind = slotKind as SlotKind;

  if (!(slotKind in slotKindLabels)) {
    logger.warn('Unknown slot kind, using fallback to meeting', { slotKind }, { component: 'schedule' });
    return slotKindLabels.meeting;
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
    logger.warn('Unknown slot kind, using fallback to meeting', { slotKind }, { component: 'schedule' });
    return slotKindColors.meeting;
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
