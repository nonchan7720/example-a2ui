#!/usr/bin/env bash
# Claude Agent SDK (TS) 0.3.317 → LiteLLM Proxy v1.108.9 (Docker) → Anthropic API で tool search が動くかを確かめる。
#
#   SDK ─→ tap(4100) ─→ LiteLLM(4000, Docker) ─→ tap(4101) ─→ api.anthropic.com
#
# 必要なもの: Node.js 22 以上、Docker、Claude Code のログイン (OAuth)。
# 使い方: bash run.sh        結果は ../../docs/evidence/litellm-toolsearch/result.txt にも残る。
set -euo pipefail
cd "$(dirname "$0")"

result=../../docs/evidence/litellm-toolsearch/result.txt
mkdir -p "$(dirname "$result")"
[ -d node_modules ] || npm install --no-audit --no-fund --no-package-lock

export LITELLM_MASTER_KEY="sk-$(openssl rand -hex 24)"
pids=()
cleanup() {
  docker compose down >/dev/null 2>&1 || true
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

rm -rf logs && mkdir logs
node tap.mjs 4100 http://127.0.0.1:4000 client >/dev/null &
pids+=($!)
node tap.mjs 4101 https://api.anthropic.com upstream >/dev/null &
pids+=($!)

docker compose up -d --quiet-pull
for _ in $(seq 60); do
  curl -sf http://127.0.0.1:4000/health/liveliness >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:4000/health/liveliness >/dev/null || { echo 'LiteLLM が起動しなかった'; docker compose logs | tail -20; exit 1; }

# 1 パターン実行し、中継の記録をパターン名で取り分ける。
run() {
  local name=$1
  node toolsearch.mjs "$@" 2>&1 | grep "^\[$name\]" || echo "[$name] 出力なし(失敗)"
  grep -ho 'mode=[a-z-]*, ENABLE_TOOL_SEARCH=[^,]*, result=[a-z]*' "logs/$name.debug.txt" | head -1 | sed "s/^/[$name] SDK の判定: /" || true
  for side in client upstream; do
    [ -f "logs/$side.jsonl" ] && mv "logs/$side.jsonl" "logs/$name.$side.jsonl"
  done
  echo
}

{
  echo "SDK: @anthropic-ai/claude-agent-sdk $(node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version")"
  echo "LiteLLM: $(docker compose exec -T litellm python -c 'import importlib.metadata as m; print(m.version("litellm"))') ($(docker compose config --images))"
  echo "Node.js: $(node --version)"
  echo

  run direct direct unset
  # ここから LiteLLM 経由。LiteLLM の認証は別ヘッダーで渡し、Authorization は Claude の認証のまま通す。
  export ANTHROPIC_CUSTOM_HEADERS="x-litellm-api-key: Bearer $LITELLM_MASTER_KEY"
  run litellm-unset http://127.0.0.1:4100 unset
  run litellm-true http://127.0.0.1:4100 true
  run litellm-false http://127.0.0.1:4100 false

  node analyze.mjs litellm-unset litellm-true litellm-false
} | tee "$result"
