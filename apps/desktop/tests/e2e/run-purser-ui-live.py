import json
import os
import re
import shutil
import subprocess
import ssl
import urllib.request
from pathlib import Path

purser = Path('/Users/avedelphina/Local/Purser')
profile = Path('/Users/avedelphina/.hermes/profiles/anikke')
backup_dir = Path('/Users/avedelphina/.hermes/profiles/anikke/cache/scratch/purser-ui-backup')
backup_dir.mkdir(parents=True, exist_ok=True)
for name in ('.env', 'config.yaml'):
    source = profile / name
    if source.exists(): shutil.copy2(source, backup_dir / name)

admin = os.environ.get('PURSER_ADMIN_TOKEN')
if not admin:
    admin = next(line.split('=', 1)[1].strip() for line in open(purser / '.env') if line.startswith('PURSER_ADMIN_TOKEN='))
assert admin
purser_admin_url = os.environ.get('PURSER_ADMIN_URL', 'http://127.0.0.1:8081').rstrip('/')
purser_gateway_url = os.environ.get('PURSER_GATEWAY_URL', 'https://credits.ocean').rstrip('/')
if not re.fullmatch(r'https://[a-z0-9.-]+(?::\d+)?(?:/[a-z0-9._-]+)*|http://127\.0\.0\.1(?::\d+)?', purser_admin_url, re.IGNORECASE):
    raise RuntimeError('PURSER_ADMIN_URL must be HTTPS, except local loopback')
if not re.fullmatch(r'https://[a-z0-9.-]+(?::\d+)?', purser_gateway_url, re.IGNORECASE):
    raise RuntimeError('PURSER_GATEWAY_URL must be an HTTPS origin')

def api(path, body=None, method=None):
    headers = {'Authorization': 'Bearer ' + admin}
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    request = urllib.request.Request(purser_admin_url + path, data=data, headers=headers, method=method or ('POST' if body is not None else 'GET'))
    context = ssl.create_default_context() if purser_admin_url.startswith('https://') else None
    with urllib.request.urlopen(request, timeout=5, context=context) as response:
        return json.load(response)

# Production's account id is deliberately resolved at test time rather than
# copied from a local development database.
accounts = api('/admin/accounts')['accounts']
tom = next((account for account in accounts if account['display_name'] == 'Tom Frost'), None)
if tom is None:
    raise RuntimeError('Purser production account “Tom Frost” was not found')
baseline_ledger = api('/admin/accounts/' + tom['id'] + '/ledger?limit=100')['ledger']
minted = api('/admin/accounts/' + tom['id'] + '/keys', {
    'service_id': 'hermes-cowork', 'instance_id': 'anikke', 'curated': True,
    'can_manage': False, 'sub_billing': False,
})
key = minted['api_key']
try:
    env = {
        **os.environ,
        'PURSER_COWORK_E2E_KEY': key,
        'PURSER_COWORK_E2E_ENDPOINT': purser_gateway_url,
        'PURSER_COWORK_E2E_FUNDING_REF': tom['id'],
    }
    subprocess.run(
        ['pnpm', '--filter', '@hermes-cowork/desktop', 'exec', 'playwright', 'test',
         'tests/e2e/purser-config.spec.ts', 'tests/e2e/purser-task-live.spec.ts', '--workers=1', '--reporter=line'],
        cwd='/Users/avedelphina/Hermes-Cowork', env=env, check=True)
    after_ledger = api('/admin/accounts/' + tom['id'] + '/ledger?limit=100')['ledger']
    new_rows = [row for row in after_ledger if row['id'] not in {item['id'] for item in baseline_ledger}]
    spend_rows = [row for row in new_rows if row['kind'] not in {'credit', 'grant'}]
    if not spend_rows:
        usage = api('/admin/usage/summary?since=10m&group_by=project,parent,agent,job_class')
        raise RuntimeError(
            'Live UI response was not proven to reach Purser: no new spend ledger row appeared; '
            f"usage summary totals={usage.get('totals')}"
        )
    print(f'Purser ledger verified: {len(spend_rows)} new spend row(s), latest={spend_rows[0]}')
finally:
    for name in ('.env', 'config.yaml'):
        target = profile / name
        saved = backup_dir / name
        if saved.exists(): shutil.copy2(saved, target)
        elif target.exists(): target.unlink()
    api('/admin/keys/' + minted['key_id'], method='DELETE')
    print('restored Anikke profile config and revoked temporary Purser key')
