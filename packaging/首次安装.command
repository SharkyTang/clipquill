#!/bin/zsh
set -e
package_dir="${0:A:h}"
echo "正在安装 ClipQuill 本地助手。首次需要联网下载模型，请保持本窗口打开。"
if ! "$package_dir/payload/runtime/bin/python3.12" -B "$package_dir/payload/scripts/install_helper.py" --package "$package_dir"; then
  echo "安装未完成。重新双击此文件可以继续下载和安装。"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
echo "安装完成后可以关闭此窗口。以后直接在插件里点击提取文案。"
