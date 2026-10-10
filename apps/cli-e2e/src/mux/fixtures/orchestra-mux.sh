#!/usr/bin/env bash
# The mux arm of Orchestra's Bash backend seam, as the design specifies
# it (docs/design/windows-support.md, "Orchestra's Bash backend seam"):
# requests encoded with json_str on stdin, the fixed TSV split on its
# first 30 tabs, captures sampled as base64. Each step prints one
# `key=value` line for the test to check.
#
# Usage: orchestra-mux.sh CWD AGENT_SCRIPT, with N10 naming the command.
set -euo pipefail

cwd=$1 agent=$2
n10() { "$N10_NODE" "$N10_MAIN" "$@"; }

# json_str, verbatim from Orchestra's player/scripts/_routing.sh at
# notaharness/plugins@431094cf8995267a212d7ab39c3bbf592746ea94.
json_str() {
  local s="$1" i c
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"; s="${s//$'\b'/\\b}"; s="${s//$'\f'/\\f}"
  for i in 1 2 3 4 5 6 7 11 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31; do
    printf -v c "\\$(printf %03o "$i")"
    case "$s" in *"$c"*) s="${s//"$c"/$(printf '\\u%04x' "$i")}";; esac
  done
  printf '"%s"' "$s"
}

native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"
  else printf '%s' "$1"; fi
}

# split_row ROW: ROW_FIELDS[0..29] and ROW_FIELDS[30], the title.
split_row() {
  local row=$1 i
  ROW_FIELDS=()
  for ((i = 0; i < 30; i++)); do
    ROW_FIELDS+=("${row%%$'\t'*}")
    row=${row#*$'\t'}
  done
  ROW_FIELDS+=("$row")
}

IFS=$'\t' read -r _ host_id owner_type _ count caps < <(n10 mux status)
echo "status=$owner_type,$count,$caps"

wt=$(native_path "$cwd") node=$(native_path "$N10_NODE")
main=$(native_path "$N10_MAIN") script=$(native_path "$agent")
request="{\"requestId\":\"spawn-1\",\"expectedHostId\":$(json_str "$host_id"),"
request+="\"label\":\"player\",\"cwd\":$(json_str "$wt"),"
request+="\"argv\":[$(json_str "$node"),$(json_str "$script"),$(json_str "$main")],"
request+="\"envSet\":{\"ORCHESTRA_BACKEND\":\"mux\",\"MUX_AGENT_CLAIM\":\"claude:abc\"},\"cols\":120,\"rows\":30,"
request+="\"retainOnExit\":true,\"tags\":{\"@orchestra-spawner\":\"orchestra\","
request+="\"@orchestra-session-type\":\"worktree\",\"@orchestra-worktree-path\":$(json_str "$wt")}}"
split_row "$(printf '%s' "$request" | n10 mux create --request -)"
id=${ROW_FIELDS[0]} generation=${ROW_FIELDS[2]}
echo "created=${ROW_FIELDS[6]},${ROW_FIELDS[14]},${ROW_FIELDS[16]}"

if printf '%s' "$request" | n10 mux create --request - >/dev/null 2>err.txt; then
  echo "duplicate=created"
else
  echo "duplicate=$?,$(cut -f1 err.txt)"
fi

sample() {
  local row
  while IFS= read -r row; do
    split_row "$row"
    [ "${ROW_FIELDS[0]}" = "$id" ] || continue
    printf '%s' "${ROW_FIELDS[29]}" | base64 -d
  done < <(n10 mux list --capture 0)
}
for _ in $(seq 100); do sample | grep -q ready && break; sleep 0.1; done
echo "self=$(sample | grep -o 'self=[^[:space:]]*')"
echo "selfclaim=$(sample | grep -o 'claim=[^[:space:]]*')"
split_row "$(n10 mux inspect "$id")"
echo "title=${ROW_FIELDS[30]}"

message=$'hello\ttab ünïcode \e[x'
send="{\"requestId\":\"send-1\",\"expectedHostId\":$(json_str "$host_id"),"
send+="\"generation\":$generation,\"mode\":\"paste\",\"text\":$(json_str "$message"),\"submit\":true}"
echo "sent=$(printf '%s' "$send" | n10 mux send "$id" --request - | tr '\t' ',')"
for _ in $(seq 100); do n10 mux capture "$id" | grep -q '^got:' && break; sleep 0.1; done
echo "echoed=$(n10 mux capture "$id" | grep '^got:')"

# A claim is a session's own: from outside it is refused, and the one
# the agent made for itself stands.
claim="{\"expectedHostId\":$(json_str "$host_id"),\"claimTarget\":\"claude:xyz\"}"
if printf '%s' "$claim" | n10 mux metadata "$id" --request - >/dev/null 2>err.txt; then
  echo "outsideclaim=accepted"
else
  echo "outsideclaim=$?,$(cut -f1 err.txt)"
fi
split_row "$(n10 mux inspect "$id")"
echo "claimed=${ROW_FIELDS[24]}"

exit_line="{\"expectedHostId\":$(json_str "$host_id"),\"generation\":$generation,"
exit_line+="\"mode\":\"literal\",\"text\":\"exit\",\"submit\":true}"
printf '%s' "$exit_line" | n10 mux send "$id" --request - >/dev/null
for _ in $(seq 100); do
  split_row "$(n10 mux inspect "$id")"
  [ "${ROW_FIELDS[6]}" = exited ] && break
  sleep 0.1
done
echo "exited=${ROW_FIELDS[6]},${ROW_FIELDS[8]}"

stop="{\"expectedHostId\":$(json_str "$host_id"),\"generation\":$generation}"
printf '%s' "$stop" | n10 mux stop "$id" --request -
echo "listed=$(n10 mux list | wc -l | tr -d ' ')"
