#!/bin/sh
# Validates fhir/examples/*.json with the OFFICIAL HL7 FHIR validator (needs Java 11+ and internet access).
#   sh scripts/validate-hl7.sh            downloads validator_cli.jar once into scripts/.cache/
# Terminology is not validated (-tx n/a): the exports carry text only, no coded values.
# Expected result: "Success" with only informational notes. Any "Error" line is a real conformance problem.
set -eu
cd "$(dirname "$0")/.."
JAR="scripts/.cache/validator_cli.jar"
URL="https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar"
mkdir -p scripts/.cache
if [ ! -f "$JAR" ]; then
  echo "downloading $URL"
  curl -fL -o "$JAR" "$URL"
fi
java -jar "$JAR" examples/*.json -version 4.0.1 -tx n/a
