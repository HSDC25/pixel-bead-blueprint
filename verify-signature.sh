#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-.}"
PY="${PYTHON:-python3}"
EXPECTED_FP='4A56E5FAFB41A200F6B1E07E8868AAAE1613EAC3E2E138E44860231D1B5D0124'

SRC="$(cd "$DIR" && pwd -P)"
[ -f "$SRC/SIGNATURE.md" ] || { echo '没找到 SIGNATURE.md：请指向解压后的 skill 目录。' >&2; exit 2; }

if ! "$PY" -c 'import model_signing' >/dev/null 2>&1; then
  echo "缺少 model_signing。请运行：$PY -m pip install model-signing==1.1.1 certifi pyopenssl" >&2
  exit 3
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$PY" - "$SRC" "$TMP" "$EXPECTED_FP" <<'PY'
import base64
import hashlib
import pathlib
import re
import shutil
import sys

source = pathlib.Path(sys.argv[1])
temp = pathlib.Path(sys.argv[2])
expected = sys.argv[3]
md = (source / 'SIGNATURE.md').read_text(encoding='utf-8')
blocks = {}
for key, value in re.findall(r'<!-- (\w+):START -->(.*?)<!-- \1:END -->', md, re.S):
    if key in blocks:
        raise SystemExit(f'SIGNATURE.md 包含重复的 {key} 块。')
    blocks[key] = re.sub(r'\s', '', value)
for key in ('SIGBASE64', 'CERTBASE64'):
    if key not in blocks:
        raise SystemExit(f'SIGNATURE.md 缺少 {key} 块。')

signature = base64.b64decode(blocks['SIGBASE64'], validate=True)
certificate_der = base64.b64decode(blocks['CERTBASE64'], validate=True)
fingerprint = hashlib.sha256(certificate_der).hexdigest().upper()
if fingerprint != expected:
    raise SystemExit(f'证书指纹不受信任：{fingerprint}')

(temp / 'skill.oms.sig').write_bytes(signature)
certificate_b64 = blocks['CERTBASE64']
pem = '-----BEGIN CERTIFICATE-----\n' + '\n'.join(
    certificate_b64[i:i + 64] for i in range(0, len(certificate_b64), 64)
) + '\n-----END CERTIFICATE-----\n'
(temp / 'cert.pem').write_text(pem, encoding='ascii')

stage = temp / 'skill'
shutil.copytree(source, stage)
(stage / 'SIGNATURE.md').unlink()
print(f'签名 {len(signature)} B ｜ 可信证书指纹 {fingerprint}')
PY

set +e
"$PY" -m model_signing verify certificate "$TMP/skill" \
  --no-ignore-git-paths --no-ignore_unsigned_files \
  --signature "$TMP/skill.oms.sig" \
  --certificate_chain "$TMP/cert.pem"
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  echo '==> 严格验签通过：文件列表与每个文件的字节均和发布时一致。'
else
  echo "==> 严格验签失败（exit $rc）：文件被修改、被新增，或 LF 被转成了 CRLF。" >&2
fi
exit "$rc"
