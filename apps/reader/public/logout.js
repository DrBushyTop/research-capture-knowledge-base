const form = document.querySelector('form');
const requested = new URLSearchParams(location.search).get('returnTo');
if (requested) form.action = '/api/logout?returnTo=' + encodeURIComponent(requested);
form.requestSubmit();
