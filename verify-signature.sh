#!/usr/bin/env bash
# verify-signature.sh —— 验 pixel-bead-blueprint 的目录签名（Linux / macOS）
# 用法：
#   bash verify-signature.sh [skill目录，默认当前目录]
#   如 model_signing 装在虚拟环境里：PYTHON=~/msenv/bin/python bash verify-signature.sh <目录>
set -uo pipefail

DIR="${1:-.}"
PY="${PYTHON:-python3}"
cd "$DIR" || { echo "目录不存在: $DIR"; exit 2; }
[ -f SIGNATURE.md ] || { echo "没找到 SIGNATURE.md —— 这个目录不是完整包"; exit 2; }

# 依赖检查
if ! "$PY" -c 'import model_signing' >/dev/null 2>&1; then
  echo "缺少验签工具 model_signing。先装一次（约 1 分钟）："
  echo "  $PY -m pip install model-signing certifi pyopenssl"
  echo "  # 注：model-signing 1.1.1 的依赖声明漏了 certifi / pyopenssl，必须一起装"
  echo "  如装在虚拟环境：PYTHON=/path/to/venv/bin/python bash $0 $DIR"
  exit 3
fi

python3 - "$PWD" <<'PY'
import base64, io, os, re, sys
d = sys.argv[1]
md = io.open(os.path.join(d, 'SIGNATURE.md'), encoding='utf-8').read()

def grab(key):
    m = re.search(r'<!-- %s:START -->(.*?)<!-- %s:END -->' % (key, key), md, re.S)
    if not m:
        raise SystemExit('SIGNATURE.md 缺少 %s 段' % key)
    return re.sub(r'\s', '', m.group(1))

sig = base64.b64decode(grab('SIGBASE64'))
io.open(os.path.join(d, 'skill.oms.sig'), 'wb').write(sig)
c = grab('CERTBASE64')
pem = '-----BEGIN CERTIFICATE-----\n' + '\n'.join(c[i:i + 64] for i in range(0, len(c), 64)) + '\n-----END CERTIFICATE-----\n'
io.open(os.path.join(d, 'cert.pem'), 'w').write(pem)
print('签名 %d B ｜ 证书 %d B' % (len(sig), len(c)))
PY

rc=0
"$PY" -m model_signing verify certificate "$PWD" \
  --signature "$PWD/skill.oms.sig" \
  --certificate_chain "$PWD/cert.pem" \
  --ignore_unsigned_files || rc=$?
rm -f "$PWD/skill.oms.sig" "$PWD/cert.pem"

if [ "$rc" -eq 0 ]; then
  echo "==> 验签通过：这些文件与发布时逐字节一致"
else
  echo "==> 验签失败（exit $rc）：文件被改过，或换行被转成 CRLF"
fi
exit "$rc"