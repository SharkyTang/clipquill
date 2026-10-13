#!/bin/zsh
cd -- "${0:A:h}/.." || exit 1
python3 scripts/transcription_bridge.py
if [[ $? != 0 ]]; then
  echo "服务未启动。若另一个服务窗口已经打开，请保留原窗口。"
  read -k 1 "?按任意键关闭。"
fi
