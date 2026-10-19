#!/usr/bin/env python3
"""Build and sign the small Android shell using only the JDK and Android SDK."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import zipfile

APP = Path(__file__).resolve().parent
ROOT = APP.parent
LOCAL = ROOT / '.android-local'


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or LOCAL / 'sdk'))
    options = parser.parse_args()
    sdk = options.sdk.resolve()
    tools = sdk / 'build-tools' / '36.0.0'
    android = sdk / 'platforms' / 'android-36' / 'android.jar'
    for path in [android, *(tools / name for name in ['aapt2', 'd8', 'zipalign', 'apksigner'])]:
        if not path.is_file():
            sys.exit(f'Missing SDK component: {path}\nInstall platforms;android-36 and build-tools;36.0.0, or pass --sdk.')
    for name in ['java', 'javac', 'keytool']:
        if not shutil.which(name):
            sys.exit(f'Missing JDK tool: {name} (JDK 21 recommended).')

    output = APP / 'build'
    work = output / 'work'
    if work.exists():
        shutil.rmtree(work)
    for name in ['generated', 'classes', 'dex']:
        (work / name).mkdir(parents=True, exist_ok=True)
    run(tools / 'aapt2', 'compile', '--dir', APP / 'res', '-o', work / 'compiled.zip')
    run(tools / 'aapt2', 'link', '--manifest', APP / 'AndroidManifest.xml', '-I', android,
        '--java', work / 'generated', '-A', APP / 'assets', '-o', work / 'resources.apk', work / 'compiled.zip')
    sources = sorted((APP / 'src').rglob('*.java')) + sorted((work / 'generated').rglob('*.java'))
    run('javac', '--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-classpath', android, '-d', work / 'classes', *sources)
    run(tools / 'd8', '--lib', android, '--min-api', '26', '--release', '--output', work / 'dex', *sorted((work / 'classes').rglob('*.class')))
    shutil.copyfile(work / 'resources.apk', work / 'unsigned.apk')
    with zipfile.ZipFile(work / 'unsigned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in sorted((work / 'dex').glob('*.dex')):
            apk.write(dex, dex.name)
    run(tools / 'zipalign', '-P', '16', '-f', '4', work / 'unsigned.apk', work / 'aligned.apk')

    signing = LOCAL / 'signing'
    signing.mkdir(parents=True, exist_ok=True, mode=0o700)
    signing.chmod(0o700)
    key, password = signing / 'release.p12', signing / 'password'
    if key.exists() != password.exists():
        sys.exit('Signing key or password is missing. Restore the original pair to preserve APK update compatibility.')
    if not key.exists():
        fd = os.open(password, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as file:
            file.write(secrets.token_urlsafe(36) + '\n')
        try:
            run('keytool', '-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-alias', 'gladys', '-keyalg', 'RSA',
                '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Snow Gladys Personal Player',
                '-storepass:file', password, '-keypass:file', password)
        except Exception:
            # Keep any created key; never silently replace a signing identity.
            if not key.exists():
                password.unlink()
            raise
    key.chmod(0o600)
    password.chmod(0o600)
    apk = output / 'gladys-player-0.2.1.apk'
    run(tools / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'gladys', '--ks-pass', f'file:{password}',
        '--out', apk, work / 'aligned.apk')
    run(tools / 'apksigner', 'verify', '--verbose', apk)
    run(tools / 'zipalign', '-c', '-P', '16', '4', apk)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    apk.with_suffix('.apk.sha256').write_text(f'{digest}  {apk.name}\n', encoding='utf-8')
    print(f'\nAPK: {apk}\nSize: {apk.stat().st_size:,} bytes\nSHA-256: {digest}')


if __name__ == '__main__':
    build()
