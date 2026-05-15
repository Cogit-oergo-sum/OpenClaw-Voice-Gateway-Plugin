#!/bin/bash
# 批量 SLC 模型对比验证脚本（macOS 兼容版）
set -e
cd "$(dirname "$0")/.."

MODELS=(
  "qwen3.6-flash"
  "qwen3.6-plus"
  "deepseek-v4-flash"
  "deepseek-v4-pro"
  "deepseek-v3.2"
  "MiniMax/MiniMax-M2.7"
  "MiniMax/MiniMax-M2.5"
  "MiniMax/MiniMax-M2.1"
  "glm-5.1"
)

ORIG_SLC=$(grep "^SLC_MODEL=" .env | cut -d= -f2)
echo "原 SLC_MODEL: $ORIG_SLC"

RESULTS_FILE="benchmark-results-$(date +%Y%m%d-%H%M%S).txt"
echo "SLC Model Benchmark - $(date)" > "$RESULTS_FILE"
echo "============================================" >> "$RESULTS_FILE"
printf "%-30s %6s %6s %8s %10s %10s\n" "Model" "Pass" "Total" "Rate" "TTFT(ms)" "SLC(ms)" >> "$RESULTS_FILE"
echo "--------------------------------------------" >> "$RESULTS_FILE"

for MODEL in "${MODELS[@]}"; do
  echo ""
  echo "=========================================="
  echo "[$(( ${#MODELS[@]} ))] Testing SLC_MODEL=$MODEL"
  echo "=========================================="

  # 更新 .env
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^SLC_MODEL=.*/SLC_MODEL=$MODEL/" .env
  else
    sed -i "s/^SLC_MODEL=.*/SLC_MODEL=$MODEL/" .env
  fi

  # 运行验证
  OUTPUT=$(npx ts-node --transpile-only scripts/verify-zego-ai-assistant.ts 2>&1 || true)

  # 从最新报告中提取精确数据
  REPORT=$(ls -t ../openclaw-test-env/workspace_standalone_zegoAIAssistant/verify-report-*.txt 2>/dev/null | head -1)

  if [ -n "$REPORT" ]; then
    # 从报告末尾 SUMMARY 部分提取
    PASS_COUNT=$(grep "^Passed" "$REPORT" | awk '{print $3}' | tr -d ' ')
    TOTAL=$(grep "^Total scenarios:" "$REPORT" | awk '{print $3}')
    PASS_RATE=$(grep "^Pass rate:" "$REPORT" | awk '{print $3}')

    # 从 LATENCY SUMMARY 提取平均延迟
    TTFT=$(grep "| TTFT" "$REPORT" | awk -F'|' '{print $3}' | awk '{print $1}' | tr -d ' ')
    SLC_LAT=$(grep "| SLC " "$REPORT" | awk -F'|' '{print $3}' | awk '{print $1}' | tr -d ' ')
  else
    # 从 stdout 提取
    PASS_RATE=$(echo "$OUTPUT" | grep "SUMMARY:" | tail -1 | sed 's/.*(\([0-9.]*%\))/\1/')
    PASS_COUNT="?"
    TOTAL="33"
    TTFT="N/A"
    SLC_LAT="N/A"
  fi

  [ -z "$PASS_COUNT" ] && PASS_COUNT="?"
  [ -z "$TOTAL" ] && TOTAL="33"
  [ -z "$PASS_RATE" ] && PASS_RATE="0%"
  [ -z "$TTFT" ] && TTFT="N/A"
  [ -z "$SLC_LAT" ] && SLC_LAT="N/A"

  echo "  结果: $PASS_COUNT/$TOTAL ($PASS_RATE) | TTFT: ${TTFT}ms | SLC: ${SLC_LAT}ms"

  printf "%-30s %6s %6s %8s %10s %10s\n" "$MODEL" "$PASS_COUNT" "$TOTAL" "$PASS_RATE" "$TTFT" "$SLC_LAT" >> "$RESULTS_FILE"
done

# 恢复原始 .env
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/^SLC_MODEL=.*/SLC_MODEL=$ORIG_SLC/" .env
else
  sed -i "s/^SLC_MODEL=.*/SLC_MODEL=$ORIG_SLC/" .env
fi

echo ""
echo "=========================================="
echo "Benchmark 完成! 原始 SLC_MODEL 已恢复: $ORIG_SLC"
echo "=========================================="
echo ""
cat "$RESULTS_FILE"
