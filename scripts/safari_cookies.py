#!/usr/bin/env python3
"""
Extract amazon.com cookies from Brave (or Chrome) on macOS.
Chromium encrypts cookie values with AES-128-CBC using a key derived
from the 'Brave Safe Storage' (or 'Chrome Safe Storage') keychain entry.
"""
import json
import os
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import base64

DOMAINS = ('amazon.com', 'read.amazon.com')

BROWSER_PROFILES = [
    # (keychain_service, db_path)
    (
        'Brave Safe Storage',
        os.path.expanduser(
            '~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies'
        ),
    ),
    (
        'Chrome Safe Storage',
        os.path.expanduser(
            '~/Library/Application Support/Google/Chrome/Default/Cookies'
        ),
    ),
]


def get_encryption_key(service):
    """Retrieve the browser's safe-storage password from macOS Keychain."""
    result = subprocess.run(
        ['security', 'find-generic-password', '-s', service, '-w'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f'Could not get key for "{service}" from Keychain')
    return result.stdout.strip()


def decrypt_value(ciphertext, key):
    """Decrypt a Chromium cookie value (AES-128-CBC, PBKDF2 key)."""
    try:
        from Crypto.Cipher import AES
        from Crypto.Protocol.KDF import PBKDF2
        from Crypto.Hash import SHA1, HMAC

        # Chromium prefix: b'v10'
        if not ciphertext.startswith(b'v10'):
            return ciphertext.decode('utf-8', errors='replace')

        ciphertext = ciphertext[3:]
        derived = PBKDF2(
            key.encode('utf-8'),
            b'saltysalt',
            dkLen=16,
            count=1003,
            prf=lambda p, s: HMAC.new(p, s, SHA1).digest(),
        )
        iv = b' ' * 16
        cipher = AES.new(derived, AES.MODE_CBC, IV=iv)
        decrypted = cipher.decrypt(ciphertext)
        # Remove PKCS7 padding
        pad = decrypted[-1]
        return decrypted[:-pad].decode('utf-8', errors='replace')
    except Exception:
        return ''


def extract_cookies():
    for service, db_path in BROWSER_PROFILES:
        if not os.path.exists(db_path):
            continue
        try:
            enc_key = get_encryption_key(service)
        except RuntimeError:
            continue

        # Copy DB to temp (browser may have it locked)
        tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        tmp.close()
        shutil.copy2(db_path, tmp.name)

        try:
            con = sqlite3.connect(tmp.name)
            con.row_factory = sqlite3.Row
            # Detect schema — older Chromium uses secure/httponly, newer uses is_secure/is_httponly
            cols = {r[1] for r in con.execute('PRAGMA table_info(cookies)').fetchall()}
            sec_col  = 'is_secure'  if 'is_secure'   in cols else 'secure'
            http_col = 'is_httponly' if 'is_httponly' in cols else 'httponly'

            rows = con.execute(
                f'SELECT host_key, name, path, encrypted_value, {sec_col}, {http_col}, expires_utc '
                'FROM cookies WHERE host_key LIKE "%amazon%"'
            ).fetchall()
            con.close()
        finally:
            os.unlink(tmp.name)

        cookies = []
        for row in rows:
            value = decrypt_value(bytes(row['encrypted_value']), enc_key)
            if not value:
                continue

            # Chrome stores expiry as microseconds since 1601-01-01
            # Convert to Unix timestamp (seconds since 1970-01-01)
            exp = row['expires_utc']
            expiry_unix = (exp // 1_000_000) - 11644473600 if exp else None

            cookies.append({
                'url':            f"https://{row['host_key'].lstrip('.')}",
                'domain':         row['host_key'],
                'name':           row['name'],
                'path':           row['path'],
                'value':          value,
                'secure':         bool(row[sec_col]),
                'httpOnly':       bool(row[http_col]),
                'expirationDate': expiry_unix,
            })
        return cookies

    raise RuntimeError('No supported browser found or no cookies accessible.')


if __name__ == '__main__':
    try:
        print(json.dumps(extract_cookies()))
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
