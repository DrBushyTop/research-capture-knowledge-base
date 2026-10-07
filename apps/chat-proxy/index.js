import { app } from '@azure/functions';
import { handler, sessionHandler } from './proxy.js';

app.http('chat', { route: 'chat', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(false) });
app.http('categories', { route: 'categories', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(true) });
app.http('session', { route: 'session', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: sessionHandler(false) });
app.http('startSession', { route: 'session-start', methods: ['POST'], authLevel: 'anonymous', handler: sessionHandler(false, true) });
app.http('logout', { route: 'logout', methods: ['POST'], authLevel: 'anonymous', handler: sessionHandler(true) });
