import type { DlRule, Settings } from '../shared/settings';

/** The words the settings screens show for each choice. Those choices are numbers and names (see shared/settings.ts). */

export const speedLabel = (n: number) => `${n}×`;
export const skipLabel = (s: Settings['skip']) => `${s.back} / ${s.fwd} s`;
export const keepLabel = (k: Settings['keep']) => (k === 'all' ? 'All' : String(k));
export const delLabel = (d: Settings['del']) => ({ never: 'Never', day: '1 day', week: '1 week' })[d];
export const dlRuleLabel = (r: DlRule) => (r === 'all' ? 'All' : r === 'off' ? 'Off' : `Latest ${r}`);

// A show's own choices: undefined follows the global setting (the word differs where "no skip" is the default).
export const GLOBAL = 'Global';
export const orGlobal = <T,>(label: (v: T) => string) => (v: T | undefined) => (v === undefined ? GLOBAL : label(v));
export const onOff = (v: boolean) => (v ? 'On' : 'Off');
export const introLabel = (v: number | undefined) => (v === undefined ? 'Off' : `${v} s`);
