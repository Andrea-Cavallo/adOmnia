#!/usr/bin/env bash
# Riassume un profilo di coverage Go (`go test -coverprofile`) in Markdown: totale e tabella per package.
# Conta solo il codice di dominio (internal/ e cmd/): il package radice Wails (embed + GTK) resta fuori,
# come nel job Sonar. Percentuale pesata sugli statement, come `go tool cover`.
#
# Uso locale:  go test ./internal/... ./cmd/... -coverprofile=coverage.out -covermode=atomic
#              scripts/coverage-summary.sh coverage.out
# In CI il risultato va nel riepilogo del job (GITHUB_STEP_SUMMARY). Soglia awesome-go: 80%.
set -euo pipefail

profile="${1:-coverage.out}"
threshold="${COVERAGE_THRESHOLD:-80}"

if [[ ! -s "$profile" ]]; then
  echo "### Go coverage"
  echo
  echo "No coverage profile at \`$profile\` (the test step failed before writing it)."
  exit 0
fi

# Una riga per package: "<percentuale>\t<package>\t<statement coperti>\t<statement totali>".
rows="$(awk '
  NR == 1 && /^mode:/ { next }
  {
    split($1, location, ":")
    file = location[1]
    if (file !~ /\/(internal|cmd)\//) next
    package = file
    sub(/\/[^\/]*$/, "", package)
    total[package] += $2
    if ($3 > 0) covered[package] += $2
  }
  END {
    for (package in total) {
      printf "%.1f\t%s\t%d\t%d\n", 100 * covered[package] / total[package], package, covered[package], total[package]
    }
  }
' "$profile" | sort -t "$(printf '\t')" -k1,1n -k2,2)"

if [[ -z "$rows" ]]; then
  echo "### Go coverage"
  echo
  echo "The profile has no \`internal/\` or \`cmd/\` code."
  exit 0
fi

summary="$(printf '%s\n' "$rows" | awk -F '\t' -v threshold="$threshold" '
  { covered += $3; total += $4; packages++; if ($1 >= threshold) ok++ }
  END { printf "%.1f\t%d\t%d\t%d\t%d", 100 * covered / total, covered, total, ok, packages }
')"
IFS=$'\t' read -r percent covered total ok packages <<<"$summary"

echo "### Go coverage: ${percent}%"
echo
echo "${covered} of ${total} statements in \`internal/\` and \`cmd/\`. ${ok} of ${packages} packages are at ${threshold}% or more (awesome-go asks for ${threshold}% on non-data packages, where applicable)."
echo
echo "<details><summary>Per package, lowest first</summary>"
echo
echo "| Package | Coverage | Statements |"
echo "|---------|---------:|-----------:|"
printf '%s\n' "$rows" | awk -F '\t' '{ printf "| `%s` | %s%% | %d / %d |\n", $2, $1, $3, $4 }'
echo
echo "</details>"
