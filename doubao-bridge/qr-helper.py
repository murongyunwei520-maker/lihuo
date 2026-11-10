"""豆包扫码登录助手（stdout JSON 行协议）。

复用 doubao2api 已经验证可用的 QRLogin：走 passport 接口拿二维码，扫码确认后拿到 cookies。
由 doubao-bridge 拉起，bridge 负责把二维码写文件、把 cookies 注入对应账号的 dbb profile。

输出行：
  {"type":"qr","base64":"..."}                    二维码 PNG
  {"type":"status","state":"waiting_scan",...}    状态变化
  {"type":"cookies","cookies":{...},"sessionid":} 登录成功
  {"type":"failed","message":"..."}               失败
"""

import base64
import json
import sys
import time

from doubao2api.qr_login import QRLogin, QRStatus


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    qr = QRLogin()
    done = {"result": None}

    def on_status(status, message):
        emit({"type": "status", "state": getattr(status, "value", str(status)), "message": message or ""})

    def on_done(result):
        done["result"] = result
        if result.status == QRStatus.CONFIRMED:
            emit({"type": "cookies", "cookies": result.cookies, "sessionid": result.sessionid})
        else:
            emit({"type": "failed", "message": result.error or getattr(result.status, "value", str(result.status))})

    qr.start(on_status=on_status, on_done=on_done)

    # 等二维码渲染出来
    for _ in range(300):
        if qr.qrcode_data:
            break
        time.sleep(0.1)
    if qr.qrcode_data:
        emit({"type": "qr", "base64": base64.b64encode(qr.qrcode_data).decode("ascii")})
    else:
        emit({"type": "failed", "message": "二维码获取超时"})
        return 1

    # 保持进程不退出，直到扫码结束（bridge 会读 stdout）
    deadline = time.time() + 8 * 60
    while qr.is_running and time.time() < deadline:
        time.sleep(0.3)

    if done["result"] is None and not qr.is_running:
        emit({"type": "failed", "message": "登录流程结束但没有结果"})
        return 1
    if time.time() > deadline:
        emit({"type": "failed", "message": "等待扫码超时"})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
