#!/usr/bin/env bash
# فحوصات لا تحتاج متصفح: بناء متزامن + صياغة JS + اختبارات الباك إند تحت أكثر من Timezone.
# (اختبارات المتصفح: bash tests/run_ui_tests.sh — تحتاج Playwright)
cd "$(dirname "$0")/.." || exit 1
rc=0
echo "=== build --check ==="; python3 tools/build.py --check || rc=1
echo "=== JS syntax (app.js + .gs) ==="
node --check parts/app.js || rc=1
for f in Code Backend Reports Config Helpers Assets; do cp "$f.gs" "/tmp/_chk_$f.js" && node --check "/tmp/_chk_$f.js" || rc=1; rm -f "/tmp/_chk_$f.js"; done
for tz in Africa/Cairo UTC America/New_York Pacific/Kiritimati; do
  echo "=== backend tests TZ=$tz ==="
  out=$(TZ=$tz node --test tests/backend.test.js 2>&1); echo "$out" | grep -E "^# (tests|pass|fail)|^not ok"
  echo "$out" | grep -q "^# fail 0" || rc=1
done
[ $rc -eq 0 ] && echo "ALL OK" || echo "FAILED"
exit $rc
