const form = document.querySelector('form');
const params = new URLSearchParams(location.search);
const requested = params.get('returnTo');
if (requested) form.action = '/api/logout?returnTo=' + encodeURIComponent(requested);
if (params.get('failed') === '1') {
  document.querySelector('h1').textContent = 'Could not confirm sign-out';
  document.querySelector('p').textContent = 'Try again to finish signing out.';
  form.querySelector('button').textContent = 'Try again';
} else {
  form.requestSubmit();
}
