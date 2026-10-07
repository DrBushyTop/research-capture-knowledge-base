import { app } from '@azure/functions';
import { handler } from './proxy.js';

app.http('chat', { route: 'chat', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(false) });
app.http('categories', { route: 'categories', methods: ['POST', 'GET'], authLevel: 'anonymous', handler: handler(true) });
