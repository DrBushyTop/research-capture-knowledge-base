import { createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from '@tanstack/react-router';
import Layout, { NotFound } from './Layout';
import Chat from '../components/Chat';
import Sources from '../components/Sources';
import Categories from '../components/Categories';

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
  interface StaticDataRouteOption { title?: string }
}

export type SourcesSearch = { source?: string; q?: string; category?: string; topic?: string; type?: string; year?: string };
export type CategoriesSearch = { source?: string };
const text = (value: unknown, max = 200) => {
  const string = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof string === 'string' && string.trim() ? string.slice(0, max) : undefined;
};
const sourceId = (value: unknown) => typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value) ? value : undefined;

export function parseSourcesSearch(search: Record<string, unknown>): SourcesSearch {
  const result: SourcesSearch = { source: sourceId(search.source), q: text(search.q), category: text(search.category, 80), topic: text(search.topic), type: text(search.type, 80), year: text(search.year, 10) };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}
export const parseCategoriesSearch = (search: Record<string, unknown>): CategoriesSearch => {
  const source = sourceId(search.source);
  return source ? { source } : {};
};
export const conversationIdPattern = /^[a-f0-9]{32}$/;
/** For links that open in a new tab or leave the router. Internal navigation uses Link with the same route. */
export const sourceHref = (id: string) => `/sources/?source=${encodeURIComponent(id)}`;

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });
// Chat stays mounted between / and /chat/$conversationId/, so a new conversation keeps its running answer when its URL appears.
const chatRoute = createRoute({ getParentRoute: () => rootRoute, id: 'chat', component: Chat, staticData: { title: 'Chat' } });
export const chatIndexRoute = createRoute({ getParentRoute: () => chatRoute, path: '/', component: Outlet });
export const conversationRoute = createRoute({ getParentRoute: () => chatRoute, path: '/chat/$conversationId', component: Outlet });
export const sourcesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sources', component: Sources, validateSearch: parseSourcesSearch, staticData: { title: 'Sources' } });
export const categoriesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/categories', component: Categories, validateSearch: parseCategoriesSearch, staticData: { title: 'Categories' } });

const routeTree = rootRoute.addChildren([chatRoute.addChildren([chatIndexRoute, conversationRoute]), sourcesRoute, categoriesRoute]);

export const createAppRouter = (history?: RouterHistory) => createRouter({ routeTree, history, trailingSlash: 'always', scrollRestoration: true });
export const router = createAppRouter();
