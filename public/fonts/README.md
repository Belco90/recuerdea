# Self-hosted fonts

Variable woff2 files for the four Recuerdea typefaces. Latin subset only
(covers Spanish accented characters: á é í ó ú ü ñ €). The browser uses each
file's variable weight axis, so weights 400/500/600 share a single woff2 per
family/style.

| File                          | Family         | Style  | Weight axis | Source           |
| ----------------------------- | -------------- | ------ | ----------- | ---------------- |
| `fraunces-latin.woff2`        | Fraunces       | normal | 100–900     | Google Fonts v38 |
| `fraunces-italic-latin.woff2` | Fraunces       | italic | 100–900     | Google Fonts v38 |
| `inter-latin.woff2`           | Inter          | normal | 100–900     | Google Fonts v20 |
| `caveat-latin.woff2`          | Caveat         | normal | 400–700     | Google Fonts v23 |
| `jetbrainsmono-latin.woff2`   | JetBrains Mono | normal | 100–800     | Google Fonts v24 |

All four families are licensed under the [SIL Open Font License](https://openfontlicense.org/).
The CDN URLs they were fetched from are the standard Google Fonts woff2 endpoints
(`https://fonts.gstatic.com/s/<family>/<version>/<hash>.woff2`); refresh by
running the steps in `tasks/plan.md` § Slice 1 if a font version bumps.
