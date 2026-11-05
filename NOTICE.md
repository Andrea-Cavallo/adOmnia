# Notices

Third-party software notices, disclaimer and attribution request for adOmnia. adOmnia itself is Copyright © 2026 Andrea Cavallo and is released under the GNU General Public License, version 3 only (GPL-3.0-only), in [LICENSE](LICENSE). The third-party components below keep their own licenses, all compatible with GPL-3.0.

## Third-Party Licenses

adOmnia includes or depends on the following third-party software:

### go-webview2
- **License**: Apache License 2.0
- **Copyright**: Copyright (c) 2021 John Chadwick
- **Repository**: https://github.com/jchv/go-webview2

### React
- **License**: MIT License
- **Copyright**: Copyright (c) Meta Platforms, Inc. and affiliates
- **Repository**: https://github.com/facebook/react

### pixelfx
- **License**: MIT License
- **Copyright**: Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez; `src/core/act.js` Copyright (c) 2026 rehan-remade
- **Repository**: https://github.com/patch-gg/pixelfx
- Bundled: the Hub mini game uses its effects. Its gallery font is not used.

### ripgrep
- **License**: dual MIT / Unlicense (the binary is distributed under the Unlicense; the source is offered under either)
- **Copyright**: Copyright (c) 2016 Andrew Gallant
- **Repository**: https://github.com/BurntSushi/ripgrep
- Bundled: release packages include a pinned `rg` binary (14.1.1) for Windows, Linux and macOS, staged by `scripts/fetch-ripgrep.mjs` with SHA-256 verification. Its `LICENSE-MIT` and `UNLICENSE` files ship next to the app (`bin/`, `Contents/Resources/licenses/`, `licenses/`). Both licenses are GPL-3.0-compatible; the app works without it, falling back to its own Go search engine.

### Babel Standalone
- **License**: MIT License
- **Copyright**: Copyright (c) 2014-present Sebastian McKenzie and other contributors
- **Repository**: https://github.com/babel/babel

### Cloudflare security-audit skill
- **License**: MIT License
- **Copyright**: Copyright (c) 2025-2026 Cloudflare, Inc.
- **Repository**: https://github.com/cloudflare/security-audit-skill
- Not bundled: the Security Center downloads it on request, with its LICENSE, into `~/.agents/skills/security-audit`.

---

## Disclaimer

This software is provided "as is" without any warranty. Use at your own risk.
The authors are not responsible for any damage or data loss that may occur
from using this software.

---

## Attribution

If you use adOmnia in your project or redistribute it, please include a link
back to the original repository: https://github.com/Andrea-Cavallo/adOmnia

---

For questions about licensing, please open an issue on GitHub.
