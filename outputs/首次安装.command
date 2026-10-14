#!/bin/zsh
cd -- "${0:A:h}" || exit 1
package_dir="$PWD/ClipQuill-v0.1.5-mac-arm64"
if [[ ! -x "$package_dir/payload/runtime/bin/python3.12" ]]; then
  echo "请先解压完整的 ClipQuill-v0.1.5-mac-arm64.zip 安装包到此文件夹。"
  read -k 1 "?按任意键关闭。"
  exit 1
fi
exec "$package_dir/payload/runtime/bin/python3.12" -B "$package_dir/payload/scripts/install_helper.py" \
  --package "$package_dir" --seed-models "$PWD/.." \
  --existing-project "$PWD/.." --existing-extension "$PWD/douyin-independent-extension"
