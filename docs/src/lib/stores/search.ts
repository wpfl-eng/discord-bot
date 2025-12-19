import { writable } from 'svelte/store';

export const searchQuery = writable<string>('');
export const searchOpen = writable<boolean>(false);
