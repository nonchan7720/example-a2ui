#!/usr/bin/env bash
# LiteLLM Proxy v1.108.9 が、SDK のリクエストを Bedrock 向けにどう変換するかを確かめる。Bedrock は呼ばない。
# 先に ../run.sh を実行して logs/litellm-true.client.jsonl を作っておくこと。
# 使い方: bash bedrock/run.sh     結果は ../../docs/evidence/litellm-toolsearch/bedrock-conversion.txt にも残る。
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f logs/litellm-true.client.jsonl ] || { echo '先に bash run.sh を実行してください'; exit 1; }

key="sk-$(openssl rand -hex 24)"
cleanup() {
  docker rm -f litellm-bedrock >/dev/null 2>&1 || true
  kill "$tap" 2>/dev/null || true
}
trap cleanup EXIT

# 転送先は存在しないポート。中継はリクエストを記録して 502 を返すだけ。
rm -f logs/bedrock.jsonl
node tap.mjs 4101 http://127.0.0.1:9 bedrock >/dev/null &
tap=$!

docker run -d --quiet --name litellm-bedrock --network host -e LITELLM_MASTER_KEY="$key" -v "$PWD/bedrock/litellm.yaml:/app/config.yaml:ro" \
  ghcr.io/berriai/litellm:v1.108.9 --config /app/config.yaml --host 127.0.0.1 --port 4000 >/dev/null
for _ in $(seq 60); do
  curl -sf http://127.0.0.1:4000/health/liveliness >/dev/null && break
  sleep 2
done

node bedrock/replay.mjs "$key" | tee ../../docs/evidence/litellm-toolsearch/bedrock-conversion.txt
