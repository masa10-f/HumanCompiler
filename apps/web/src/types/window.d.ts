/**
 * Window型拡張
 * Google Analytics gtag関数の型定義
 */

interface Gtag {
  (command: 'event', eventName: string, params?: Record<string, unknown>): void;
  (command: 'config', targetId: string, params?: Record<string, unknown>): void;
  (command: 'set', params: Record<string, unknown>): void;
  (command: string, ...args: unknown[]): void;
}

declare global {
  interface Window {
    gtag?: Gtag;
  }
}

export {};
