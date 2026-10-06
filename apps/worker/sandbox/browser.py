"""Fixed browser driver. No model-supplied Python, JavaScript, selectors or shell commands."""
import sys, json, os, time, socket, ssl, ipaddress, http.client, urllib.parse, urllib.robotparser, re
from http.server import HTTPServer, BaseHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = '/workspace/browser'
os.makedirs(ROOT, exist_ok=True)

if len(sys.argv) > 1 and sys.argv[1] == 'command':
    connection = http.client.HTTPConnection('127.0.0.1', 8765, timeout=45)
    with open(ROOT + '/command.json') as file:
        body = file.read()
    connection.request('POST', '/', body.encode('utf8'), {'Content-Type': 'application/json'})
    response = connection.getresponse()
    output = response.read(2 * 1024 * 1024)
    with open(ROOT + '/result.json', 'wb') as file:
        file.write(output)
    sys.exit(0 if response.status == 200 else 1)

with open(ROOT + '/config.json') as file:
    config = json.load(file)
origin = urllib.parse.urlsplit(config['url'])
hosts = {origin.hostname, *config.get('assetHosts', [])}
started = time.monotonic()
requests = 0
bytes_read = 0
blocked = 0
controls = {}
visited = []
robots = {}
actions = 0

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, port):
        super().__init__(host, port=port, timeout=12, context=ssl.create_default_context())
        self.address = address
    def connect(self):
        self.sock = self._context.wrap_socket(socket.create_connection((self.address, self.port), timeout=self.timeout), server_hostname=self.host)

# Browsers never open arbitrary network sockets. Every HTTP request is fulfilled through DNS-validated, pinned connections.
def fetch_public(url, browser_headers=None):
    global requests, bytes_read
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.hostname not in hosts or parsed.port not in (None, 80, 443):
        raise ValueError('Destination blocked: ' + str(parsed.hostname))
    if parsed.hostname != origin.hostname and any(word in parsed.path.lower() for word in ('collect', 'analytics', 'track')):
        raise ValueError('Tracking blocked')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('Non-public destination')
    requests += 1
    if requests > 1500 or time.monotonic() - started > 180:
        raise ValueError('Request budget reached')
    address = addresses[0][4][0]
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    connection = PinnedHTTPS(parsed.hostname, address, port) if parsed.scheme == 'https' else http.client.HTTPConnection(address, port, timeout=12)
    try:
        headers = {'Host': parsed.netloc, 'User-Agent': 'ResearchKnowledgeBase/1.0', 'Accept-Encoding': 'identity', 'Accept': '*/*'}
        for key, value in (browser_headers or {}).items():
            if key.lower() not in ('host', 'accept-encoding', 'connection', 'content-length', 'proxy-authorization'):
                if len(value) <= 16000:
                    headers[key] = value
        connection.request('GET', urllib.parse.urlunsplit(('', '', parsed.path or '/', parsed.query, '')), headers=headers)
        response = connection.getresponse()
        body = response.read(5 * 1024 * 1024 + 1)
        bytes_read += len(body)
        if len(body) > 5 * 1024 * 1024 or bytes_read > 25 * 1024 * 1024:
            raise ValueError('Network byte budget reached')
        headers = {key: value for key, value in response.getheaders() if key.lower() not in ('content-length', 'transfer-encoding', 'connection', 'content-encoding')}
        return response.status, headers, body
    finally:
        connection.close()

playwright = sync_playwright().start()
os.environ['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE'] = 'ubuntu24.04-x64'
browser = playwright.chromium.launch(headless=True, args=['--disable-dev-shm-usage', '--disable-background-networking'])
context = browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block', ignore_https_errors=True, accept_downloads=False, locale='en-US')
context.set_default_timeout(5000)
page = context.new_page()
def intercept(route):
    global blocked
    request = route.request
    try:
        parsed = urllib.parse.urlsplit(request.url)
        if request.method != 'GET' or request.resource_type in ('media', 'websocket'):
            raise ValueError('Read-only capture')
        if request.is_navigation_request() and any(word in parsed.path.lower() for word in ('login', 'signin', 'checkout', 'booking', 'reservation', 'order', 'payment')):
            raise ValueError('Consequential navigation')
        if request.is_navigation_request() and (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
            raise ValueError('Cross-origin navigation')
        if request.is_navigation_request():
            key = (parsed.scheme, parsed.netloc)
            if key not in robots:
                parser = urllib.robotparser.RobotFileParser()
                status, _, body = fetch_public(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '/robots.txt', '', '')))
                if status in (401, 403) or status >= 500:
                    raise ValueError('Robots access unavailable')
                parser.parse(body.decode('utf8', 'replace').splitlines() if status == 200 else [])
                robots[key] = parser
            if not robots[key].can_fetch('ResearchKnowledgeBase', request.url):
                raise ValueError('Robots disallow')
        outgoing = dict(request.headers)
        if request.resource_type == 'document':
            outgoing = {k: v for k, v in outgoing.items() if k.lower() not in ('rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url')}
        status, headers, body = fetch_public(request.url, outgoing)
        route.fulfill(status=status, headers=headers, body=body)
    except Exception as error:
        blocked += 1
        route.abort()
context.route('**/*', intercept)
if hasattr(context, 'route_web_socket'):
    context.route_web_socket('**/*', lambda route: route.close())

def observation():
    global controls
    page.wait_for_timeout(1000)
    try:
        page.wait_for_function("document.body && document.body.innerText.trim().length > 10", timeout=8000)
    except Exception:
        pass
    text = page.locator('body').inner_text(timeout=5000)[:20000]
    controls = {}
    output = []
    # Include custom clickable cards, not only semantic buttons. The model receives IDs, never selectors.
    candidates = page.locator('a, button, [role="button"], summary, [class*="cursor-pointer"]')
    for index in range(min(candidates.count(), 200)):
        element = candidates.nth(index)
        if not element.is_visible():
            continue
        box = element.bounding_box()
        if not box or box['x'] + box['width'] <= 0 or box['x'] >= 1280:
            continue
        label = ' '.join((element.evaluate("e => e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || (e.tagName === 'BUTTON' ? 'Navigation button' : '')") or '').split())[:200]
        if not label:
            continue
        target = str(len(output))
        controls[target] = element.element_handle()
        output.append({'id': target, 'label': label, 'kind': 'link' if element.get_attribute('href') else 'button', 'href': element.get_attribute('href') or None})
    page.screenshot(path=ROOT + '/view.png', full_page=False)
    return {'url': page.url, 'title': page.title()[:500], 'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'text': text, 'controls': output, 'blockedRequests': blocked}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_POST(self):
        try:
            global actions
            if time.monotonic() - started > 180:
                raise ValueError('Time budget reached')
            length = int(self.headers.get('Content-Length', 0))
            if length > 4000:
                raise ValueError('Command too large')
            command = json.loads(self.rfile.read(length))
            action = command['action']
            if action not in ('open', 'observe'):
                actions += 1
                if actions > 40:
                    raise ValueError('Action budget reached')
            if action == 'open':
                if visited:
                    raise ValueError('Already opened')
                page.goto(config['url'], wait_until='domcontentloaded', timeout=30000)
                visited.append(page.url)
            elif action == 'click':
                element = controls.get(command.get('target'))
                if element is None:
                    raise ValueError('Unknown control')
                label = ' '.join((element.inner_text() or '').split())
                if re.search(r'\b(login|sign in|sign up|checkout|pay|purchase|order now|add to cart|book|reserve|prenota|accedi|paga|ordina|buy|submit|send|delete|accept all|accetta tutto)\b', label, re.I):
                    raise ValueError('Consequential control')
                if element.get_attribute('type') == 'submit' or element.evaluate("e => !!e.closest('form')"):
                    raise ValueError('Form control blocked')
                href = element.get_attribute('href')
                if href and len(visited) >= 4:
                    raise ValueError('Navigation depth reached; go back')
                # Controls are captured DOM handles; activate only read-only controls, without coordinate guessing.
                element.scroll_into_view_if_needed(timeout=3000)
                element.click(timeout=5000)
                page.wait_for_timeout(500)
                if page.url != visited[-1]:
                    if page.url in visited:
                        visited[:] = visited[:visited.index(page.url) + 1]
                    elif len(visited) >= 4:
                        page.goto(visited[-1], wait_until='domcontentloaded', timeout=15000)
                        raise ValueError('Navigation depth reached')
                    else:
                        visited.append(page.url)
            elif action == 'back':
                if len(visited) > 1:
                    visited.pop()
                    page.goto(visited[-1], wait_until='domcontentloaded', timeout=15000)
                else:
                    page.goto(config['url'], wait_until='domcontentloaded', timeout=15000)
            elif action == 'reload':
                page.reload(wait_until='domcontentloaded', timeout=30000)
            elif action in ('scroll-left', 'scroll-right'):
                page.mouse.move(640, 400)
                page.mouse.wheel(-700 if action == 'scroll-left' else 700, 0)
            elif action == 'scroll':
                page.mouse.wheel(0, 700)
            elif action != 'observe':
                raise ValueError('Unknown action')
            result = observation()
            payload = json.dumps(result).encode()
            self.send_response(200)
        except Exception as error:
            payload = json.dumps({'error': type(error).__name__, 'detail': str(error)[:1000]}).encode()
            self.send_response(400)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(payload)

server = HTTPServer(('127.0.0.1', 8765), Handler)
with open(ROOT + '/ready', 'w') as file:
    file.write('ready')
server.serve_forever()
