import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { initialData, initialUi } from './initial';
import { createDownloadsSlice } from './slices/downloads';
import { createLibrarySlice } from './slices/library';
import { createPlayerSlice } from './slices/player';
import { createSettingsSlice } from './slices/settings';
import { createSyncSlice } from './slices/sync';
import { createUiSlice } from './slices/ui';
import type { State } from './types';

export * from './types';
export * from './selectors';
export { initialData } from './initial';
export { setPlayer, type Player } from './slices/player';

// subscribeWithSelector lets the engine and the tray listen to just the fields they act on.
export const useStore = create<State>()(
  subscribeWithSelector((...a) => ({
    ...initialData,
    ...initialUi,
    ...createUiSlice(...a),
    ...createPlayerSlice(...a),
    ...createDownloadsSlice(...a),
    ...createLibrarySlice(...a),
    ...createSettingsSlice(...a),
    ...createSyncSlice(...a),
  })),
);
