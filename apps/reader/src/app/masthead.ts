import { createContext } from 'react';

/** Masthead slots a page can fill with its own controls. On phones Chat moves History and New chat here instead of adding a toolbar row. */
export const MastheadSlots = createContext<{ start: HTMLElement | null; end: HTMLElement | null }>({ start: null, end: null });
