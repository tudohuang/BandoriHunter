import type { Adapter, Source } from '../types.js';
import { bookoff } from './bookoff.js';
import { hardoff } from './hardoff.js';
import { kbooks } from './kbooks.js';
import { lashinbang } from './lashinbang.js';
import { mercari } from './mercari.js';
import { surugaya } from './surugaya.js';

export const adapters: Adapter[] = [surugaya, lashinbang, kbooks, hardoff, bookoff, mercari];

export const getAdapters = (sources?: Source[]): Adapter[] =>
  sources?.length ? adapters.filter((a) => sources.includes(a.source)) : adapters;
