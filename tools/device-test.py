"""Install and run real-device smoke tests; accommodates Xiaomi foreground launch rules."""
from pathlib import Path
import subprocess, time, sys

root=Path(__file__).resolve().parents[1]
serial=sys.argv[1] if len(sys.argv)>1 else '52ec00da'
adb=['E:/Android/SDK/platform-tools/adb.exe','-s',serial]
def run(*args):
    result=subprocess.run(adb+list(args),capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    print(result.stdout+result.stderr,flush=True)
    result.check_returncode()
run('install','-r',str(root/'app/build/outputs/apk/debug/app-debug.apk'))
run('install','-r',str(root/'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'))
# Start the test content provider once; Xiaomi may hide unlaunched packages from other apps.
run('shell','content','query','--uri','content://cn.study.germanwords.test.documents/tree/root/document/root/children')
run('shell','input','keyevent','KEYCODE_WAKEUP')
process=subprocess.Popen(adb+['shell','am','instrument','-w','cn.study.germanwords.test/cn.study.germanwords.SmokeInstrumentation'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
time.sleep(2)
run('shell','am','start','-W','-n','cn.study.germanwords/.MainActivity')
try:
    raw=process.communicate(timeout=120)[0]
except subprocess.TimeoutExpired:
    process.terminate()
    raise
output=raw.decode('utf-8',errors='replace')
(root/'artifacts').mkdir(exist_ok=True)
(root/'artifacts/device-test.log').write_text(output,encoding='utf-8')
print(output,flush=True)
if 'FAIL:' in output or output.count('PASS:')<2: raise SystemExit(1)
