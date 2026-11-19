# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Kenny-Yi666/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Kenny-Yi666/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 226 DeFi protocols by implied token value — the 40 pre-token protocols on the $50M watchlist plus 186 early finds below the floor — and shows a concrete farm plan for each one. The model is `implied = TVL × category multiple × growth × maturity × chain breadth`, where the category multiple is the median mcap/TVL of that category's live-token protocols, so every value is derived from the snapshot's own figures and no protocol name is special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only. It writes `board.json`, the dashboard data, the dashboard, the screenshots and `dossier.json` into `out/`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
