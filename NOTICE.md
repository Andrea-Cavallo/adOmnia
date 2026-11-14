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

### React Flow (@xyflow/react)
- **License**: MIT License
- **Copyright**: Copyright (c) 2019-2025 webkid GmbH
- **Repository**: https://github.com/xyflow/xyflow
- Bundled: the canvas engine of Diagram Studio.

### ELK.js (elkjs)
- **License**: EPL-2.0 OR GPL-3.0-or-later (used under GPL-3.0-or-later, compatible with adOmnia's GPL-3.0-only)
- **Copyright**: Copyright (c) Kiel University and others (Eclipse Layout Kernel contributors)
- **Repository**: https://github.com/kieler/elkjs
- Bundled: Diagram Studio's auto-layout, loaded only when Auto-layout is used.

### html-to-image
- **License**: MIT License
- **Copyright**: Copyright (c) 2017-2025 W.Y.
- **Repository**: https://github.com/bubkoo/html-to-image
- Bundled: PNG and SVG export of Diagram Studio, loaded only when exporting.

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

### Simple Icons
- **License**: CC0 1.0 Universal (the collection); individual logos may carry their own license, listed in the collection's data file
- **Repository**: https://github.com/simple-icons/simple-icons
- Bundled: 3,472 SVG logos in `frontend/public/diagram-icons/tech/` (Diagram Studio → *Icons* → *Tech logos*), recolored with each brand color.
- Brand names and logos are trademarks of their respective owners. They are shown only to identify a technology in a diagram and do not imply endorsement; follow each brand's guidelines when you publish a diagram that uses them.

### AWS Architecture Icons
- **Terms**: AWS Architecture Icons terms of use — https://aws.amazon.com/architecture/icons/
- **Copyright**: © Amazon.com, Inc. or its affiliates. All rights reserved.
- Bundled: 783 PNG icons in `frontend/public/diagram-icons/aws/` (Diagram Studio → *Icons* tab), with a copy of these terms in `frontend/public/diagram-icons/NOTICE.md`.
- They are **not** covered by adOmnia's GPL-3.0 license. AWS lets customers and partners use these icons to draw architecture diagrams (in documents, presentations and similar material); the icons may not be modified, used as a logo, or used in a way that suggests AWS endorses or sponsors adOmnia or the diagram. Amazon Web Services, AWS and the service names are trademarks of Amazon.com, Inc. or its affiliates; they are used here only to identify the services the icons depict.

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
