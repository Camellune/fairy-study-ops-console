#!/usr/bin/env bash
# 一键发布到 GitHub
# 用法：GITHUB_TOKEN=xxx ./tools/publish.sh [仓库名]
set -e
REPO="${1:-fairy-study-ops-console}"
OWNER="${OWNER:-Camellune}"
: "${GITHUB_TOKEN:?请先设置 GITHUB_TOKEN 环境变量}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# 1. 建仓（幂等：已存在就跳过）
if ! curl -sS --ssl-no-revoke -m 30 -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/$OWNER/$REPO" | grep -q '"full_name"'; then
  echo "→ 创建仓库 $OWNER/$REPO"
  curl -sS --ssl-no-revoke -m 30 -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$REPO\",\"description\":\"零依赖单文件考研计划作战台：把 xlsx 计划表变成可交互的每日时间轴、作战日历与打卡看板\",\"private\":false,\"has_issues\":true,\"topics\":[\"study\",\"productivity\",\"exam-prep\",\"xlsx\",\"single-file\",\"vanilla-js\",\"offline-first\"]}" \
    | head -c 400; echo
else
  echo "→ 仓库已存在，跳过创建"
fi

# 2. 推送
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"
git branch -M main
AUTH=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
git -c http.sslVerify=false -c "http.extraheader=Authorization: Basic $AUTH" push -u origin main
echo "✓ 已推送到 https://github.com/$OWNER/$REPO"
