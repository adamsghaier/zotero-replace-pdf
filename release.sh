#!/bin/zsh
# Publish the version in manifest.json as a GitHub release that Zotero picks up
# through its update check. Commit your changes (with the version bumped) first.
#
#   ./release.sh
#
# Builds dist/<name>.xpi, creates release v<version> with it attached, then adds
# the version to updates.json (the file manifest.json's update_url points at)
# and pushes. Zotero installs it on its next update check (or Tools → Plugins →
# ⚙ → Check for Updates).
set -euo pipefail
cd "${0:A:h}"

NAME=${PWD:t}
ID=$(python3 -c 'import json;print(json.load(open("manifest.json"))["applications"]["zotero"]["id"])')
VERSION=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
MIN=$(python3 -c 'import json;print(json.load(open("manifest.json"))["applications"]["zotero"]["strict_min_version"])')
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
TAG="v$VERSION"

[[ -z "$(git status --porcelain)" ]] || { echo "Commit your changes first."; exit 1; }
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "$TAG is already released — bump \"version\" in manifest.json."; exit 1
fi
git push -q origin HEAD

mkdir -p dist
rm -f "dist/$NAME.xpi"
zip -X -q -r "dist/$NAME.xpi" manifest.json bootstrap.js $( [[ -d locale ]] && echo locale )
HASH=$(shasum -a 256 "dist/$NAME.xpi" | cut -d' ' -f1)

gh release create "$TAG" "dist/$NAME.xpi" --title "$TAG" --notes "${NOTES:-Release $TAG}" --target "$(git rev-parse HEAD)"

python3 - "$ID" "$VERSION" "$MIN" "$HASH" "https://github.com/$REPO/releases/download/$TAG/$NAME.xpi" <<'PY'
import json, sys
pid, version, minv, sha, link = sys.argv[1:]
try:
    data = json.load(open("updates.json"))
except (OSError, ValueError):
    data = {"addons": {}}
ups = data.setdefault("addons", {}).setdefault(pid, {}).setdefault("updates", [])
ups[:] = [u for u in ups if u["version"] != version]
ups.append({"version": version, "update_link": link, "update_hash": f"sha256:{sha}",
            "applications": {"zotero": {"strict_min_version": minv}}})
open("updates.json", "w").write(json.dumps(data, indent=2) + "\n")
PY
git add updates.json
git commit -q -m "updates.json: $TAG"
git push -q origin HEAD
echo "Released $TAG: dist/$NAME.xpi"
