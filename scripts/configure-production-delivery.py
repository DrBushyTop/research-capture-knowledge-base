"""Copy generated platform deployment credentials directly to their destinations, never to files/logs."""
import json
import subprocess

GROUP = 'rg-research-kb-prod'
WORKER = 'func-research-prod-16681c6a'
READER = 'swa-research-prod'
REPO = 'DrBushyTop/research-capture-knowledge-base'

def output(*args):
    return subprocess.check_output(args, text=True).strip()

def json_output(*args):
    return json.loads(output(*args))

account = json_output('az', 'account', 'show', '-o', 'json')
identity = json_output('az', 'identity', 'show', '--resource-group', GROUP, '--name', 'id-research-ci-prod', '-o', 'json')
reader = json_output('az', 'staticwebapp', 'show', '--name', READER, '--resource-group', GROUP, '-o', 'json')
for name, value in {
    'AZURE_CLIENT_ID': identity['clientId'], 'AZURE_SUBSCRIPTION_ID': account['id'],
    'AZURE_TENANT_ID': account['tenantId'], 'AZURE_RESOURCE_GROUP': GROUP,
    'FUNCTION_APP': WORKER, 'STORAGE_ACCOUNT': 'stresearchprod16681c6a',
    'KEY_VAULT_URI': 'https://kv-research-prod-16681c6.vault.azure.net/',
}.items():
    subprocess.run(['gh', 'variable', 'set', name, '--repo', REPO, '--env', 'production', '--body', value], check=True, stdout=subprocess.DEVNULL)
# Credentials are generated platform secrets, not copied Zotero credentials.
token = json_output('az', 'staticwebapp', 'secrets', 'list', '--name', READER, '--resource-group', GROUP, '-o', 'json')['properties']['apiKey']
subprocess.run(['gh', 'secret', 'set', 'SWA_DEPLOYMENT_TOKEN', '--repo', REPO, '--env', 'production'], input=token, text=True, check=True, stdout=subprocess.DEVNULL)
keys = json_output('az', 'functionapp', 'function', 'keys', 'list', '--name', WORKER, '--resource-group', GROUP, '--function-name', 'chatGateway', '-o', 'json')
key = keys.get('default')
if not key:
    raise RuntimeError('Deploy worker first so its chatGateway function key exists')
origin = 'https://' + reader['defaultHostname']
# Feed JSON through stdin; do not expose the function key in the process arguments.
url = 'https://management.azure.com' + reader['id'] + '/config/appsettings?api-version=2024-04-01'
current = json_output('az', 'rest', '--method', 'post', '--url', 'https://management.azure.com' + reader['id'] + '/listAppSettings?api-version=2024-04-01', '-o', 'json')
properties = current.get('properties', {})
properties.update({'CHAT_BACKEND_URL': 'https://' + WORKER + '.azurewebsites.net/api/chat', 'CHAT_BACKEND_KEY': key, 'READER_ORIGIN': origin, 'READER_GITHUB_USERS': 'pinaatti,DrBushyTop'})
# Azure CLI stdin body uses @-; results are suppressed so settings stay private.
subprocess.run(['az', 'rest', '--method', 'put', '--url', url, '--body', '@-', '-o', 'none'], input=json.dumps({'properties': properties}), text=True, check=True)
print(json.dumps({'productionReader': origin, 'workflowEnvironment': 'production', 'proxyConfigured': True, 'zoteroSecretsCopied': False}))
