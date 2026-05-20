#!/bin/bash
#
# release.sh - Automated release script for adOmnia
#
# Usage:
#   ./release.sh 1.0.0          # Create and push release
#   ./release.sh 1.0.0 --dry-run  # Preview without pushing
#

set -e

VERSION=$1
DRY_RUN=${2:-""}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ -z "$VERSION" ]; then
    echo -e "${RED}❌ Error: Version number required${NC}"
    echo "Usage: $0 <version> [--dry-run]"
    echo "Example: $0 1.0.0"
    exit 1
fi

# Validate version format (semver)
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}❌ Error: Invalid version format${NC}"
    echo "Version must be in format: MAJOR.MINOR.PATCH (e.g., 1.0.0)"
    exit 1
fi

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     adOmnia Release Script v$VERSION     ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Not in a git repository${NC}"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if tag already exists
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: Tag v$VERSION already exists${NC}"
    exit 1
fi

echo -e "${CYAN}📋 Pre-flight Checks${NC}"
echo -e "${GREEN}✓${NC} Version format valid: $VERSION"
echo -e "${GREEN}✓${NC} Git repository detected"
echo -e "${GREEN}✓${NC} Tag v$VERSION available"
echo ""

# Update CHANGELOG.md
echo -e "${CYAN}📝 Updating CHANGELOG.md...${NC}"
TODAY=$(date +%Y-%m-%d)

if [ -f "CHANGELOG.md" ]; then
    # Check if version already in changelog
    if grep -q "\[$VERSION\]" CHANGELOG.md; then
        echo -e "${GREEN}✓${NC} Version $VERSION already in CHANGELOG.md"
    else
        # Create release section from [Unreleased]
        sed -i.bak "/## \[Unreleased\]/a\\
\\
## [$VERSION] - $TODAY" CHANGELOG.md
        
        echo -e "${GREEN}✓${NC} Added release section to CHANGELOG.md"
        
        if [ -z "$DRY_RUN" ]; then
            git add CHANGELOG.md
            git commit -m "chore: prepare release v$VERSION"
        fi
    fi
else
    echo -e "${YELLOW}⚠️${NC}  CHANGELOG.md not found, skipping"
fi

# Build all platforms
echo ""
echo -e "${CYAN}🔨 Building release artifacts...${NC}"
if [ -z "$DRY_RUN" ]; then
    ./build.sh all "$VERSION"
else
    echo -e "${YELLOW}[DRY RUN]${NC} Would run: ./build.sh all $VERSION"
fi

# Create git tag
echo ""
echo -e "${CYAN}🏷️  Creating git tag...${NC}"
if [ -z "$DRY_RUN" ]; then
    git tag -a "v$VERSION" -m "Release v$VERSION"
    echo -e "${GREEN}✓${NC} Created tag v$VERSION"
else
    echo -e "${YELLOW}[DRY RUN]${NC} Would create tag: v$VERSION"
fi

# Show what would be released
echo ""
echo -e "${CYAN}📦 Release Artifacts:${NC}"
if [ -d "dist" ]; then
    ls -lh dist/ | grep -E "(adomnia-|SHA256)" | awk '{print "  " $9 " (" $5 ")"}'
fi

# Summary
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Release Preparation Complete${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -z "$DRY_RUN" ]; then
    echo -e "${CYAN}Next steps:${NC}"
    echo -e "  1. ${YELLOW}Review CHANGELOG.md${NC}"
    echo -e "  2. ${YELLOW}Test binaries on each platform${NC}"
    echo -e "  3. ${YELLOW}Push tag:${NC} git push origin v$VERSION"
    echo -e "  4. ${YELLOW}Create GitHub release:${NC}"
    echo ""
    echo -e "     ${CYAN}gh release create v$VERSION ./dist/* \\${NC}"
    echo -e "       ${CYAN}--title \"adOmnia v$VERSION\" \\${NC}"
    echo -e "       ${CYAN}--notes-file RELEASE_NOTES.md${NC}"
    echo ""
    
    # Ask if user wants to push now
    read -p "Push tag to GitHub now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin "v$VERSION"
        echo -e "${GREEN}✓${NC} Tag pushed to GitHub"
        echo ""
        echo "GitHub Actions will now build and create the release automatically."
        echo "Check progress at: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
    fi
else
    echo -e "${YELLOW}[DRY RUN]${NC} This was a preview. No changes were made."
    echo ""
    echo "Run without --dry-run to perform the release:"
    echo "  $0 $VERSION"
fi
