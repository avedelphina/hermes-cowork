import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

purser = Path('/Users/avedelphina/Local/Purser')
profile = Path('/Users/avedelphina/.hermes/profiles/anikke')
backup_dir = Path('/Users/avedelphina/.hermes/profiles/anikke/cache/scratch/purser-ui-backup')
backup_dir.mkdir(parents=True, exist_ok=True)
for name in ('.env', 'config.yaml'):
    source = profile / name
    if source.exists(): shutil.copy2(source, backup_dir / name)

admin = next(line.split('=', 1)[1].strip() for line in open(purser / '.env') if line.startswith('PURSER_ADMIN_TOKEN='))
def api(path, body=None, method=None):
    headers = {'Authorization': 'Bearer ' + admin}
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    request = urllib.request.Request('http://127.0.0.1:8081' + path, data=data, headers=headers, method=method or ('POST' if body is not None else 'GET'))
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)

minted = api('/admin/accounts/54cd253d123842cba1f495a6ade29e6a/keys', {
    'service_id': 'hermes-cowork', 'instance_id': 'anikke', 'curated': True,
    'can_manage': False, 'sub_billing': False,
})
key = minted['api_key']
try:
    env = {**os.environ, 'PURSER_COWORK_E2E_KEY': key}
    subprocess.run(
        ['pnpm', '--filter', '@hermes-cowork/desktop', 'exec', 'playwright', 'test',
         'tests/e2e/purser-config.spec.ts', '--reporter=line'],
        cwd='/Users/avedelphina/Hermes-Cowork', env=env, check=True)
finally:
    for name in ('.env', 'config.yaml'):
        target = profile / name
        saved = backup_dir / name
        if saved.exists(): shutil.copy2(saved, target)
        elif target.exists(): target.unlink()
    api('/admin/keys/' + minted['key_id'], method='DELETE')
    print('restored Anikke profile config and revoked temporary Purser key')
