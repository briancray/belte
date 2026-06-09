# @belte/claude-code

## 0.3.0

### Minor Changes

- [`e5f5344`](https://github.com/briancray/belte/commit/e5f5344d17e672fa4dc4b231e755f724cf5c4cc5) - settings-shaped permissions, tool gating, and tool_result frames ([`a00bb92`](https://github.com/briancray/belte/commit/a00bb923b57cadf1e6109e7408f24ebc000a32bb))

## 0.2.1

### Patch Changes

- [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5) - surface abnormal engine stops and bound the tool loops ([`d2c3215`](https://github.com/briancray/belte/commit/d2c3215bb50ba41b2407eb8878e426a164927d9d))

- Updated dependencies [[`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5), [`e772716`](https://github.com/briancray/belte/commit/e772716a190f826f0041b8358271604ad5a230a5)]:
  - @belte/belte@0.19.2

## 0.2.0

### Minor Changes

- [`d23c7ec`](https://github.com/briancray/belte/commit/d23c7ec542c180e611dd47c663cfc65319cb23ad) - `engine(config)` now controls Claude Code's posture with a single `permissionMode` option (`'default'` | `'acceptEdits'` | `'plan'` | `'dontAsk'` | `'bypassPermissions'`), replacing the `permission` allow/deny lists; `'bypassPermissions'` is wired with the SDK's required `allowDangerouslySkipPermissions` flag
