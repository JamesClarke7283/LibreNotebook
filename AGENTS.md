# AGENTS.md

Short guide for agents (and humans) working on LibreNotebook. Covers
the release process, versioning rules, commit conventions, CI, and
where things live. Read the [README](README.md) for the user-facing
overview first; this file is about *how to ship changes*.

## Release process

Releases are cut as **annotated git tags** named `v<semver>` (lowercase
`v`, no `release-` prefix). Pushing the tag is what triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml) to
build the `.deb`, `.rpm`, and AppImage and publish a GitHub Release.

Canonical steps:

1. **Bump the version** in `neutralino.config.json` (the workflow,
   the launcher, and the in-app footer all read from this file).
2. **Run the tests** — `deno task test` must be green before tagging.
3. **Commit** the version bump with a message that summarises what's
   in the release (see *Commit conventions* below).
4. **Tag and push**:
   ```bash
   git tag -a v<version> -m "v<version>: <one-line summary>"
   git push --follow-tags
   ```
   `--follow-tags` pushes the branch *and* any annotated tags reachable
   from it. Equivalent: `git push origin master && git push origin v<version>`.
5. Watch the run in the **Actions** tab. On success a release tagged
   `v<version>` lands with three attached artefacts (`*.deb`, `*.rpm`,
   `*.AppImage`).

The workflow has two other paths kept for compatibility:

- **Branch push that bumps `neutralino.config.json`** on `master`/`main`
  with no tag still triggers a build (legacy auto-trigger). Diff
  detection skips no-op pushes.
- **Manual `workflow_dispatch`** from the Actions UI — use this to
  re-publish the current version's artefacts.

**Tag clash.** `softprops/action-gh-release@v2` reuses an existing tag
gracefully, so a re-run won't create a duplicate. But re-running for a
tag that already published will *replace* the attached artefacts.
Re-tag deliberately.

## Versioning

We follow [SemVer 2.0.0](https://semver.org/) on the version in
`neutralino.config.json`:

| Part   | Bump when…                                                      |
|--------|------------------------------------------------------------------|
| major  | a breaking change — config-file rename, dropped run mode, DB schema break without migration, removed CLI flag |
| minor  | backward-compatible feature or new optional knob — new `.env` var, new packaging target, new ingest source type |
| patch  | bugfix, doc-only update, or behaviour-preserving refactor       |

Concrete examples from this project's history:

- **0.0.x → 0.1.0** would be the first minor bump after the multi-user
  split: a new `.env` flag (`MULTI_USER`) was added without breaking
  existing single-user installs.
- **0.1.0 → 0.1.1** was a patch: window-mode forces single-user
  regardless of `$MULTI_USER`, fixing a leaking-config bug.
- A future change that removes window mode entirely would be a major
  bump (drops a documented run mode).

## Commit conventions

Commits use a loose conventional-commit-ish prefix style. One-line
summary, lower-case prefix, optional scope in parens:

| Prefix       | When                                                         |
|--------------|--------------------------------------------------------------|
| `feat:`      | new user-visible capability                                  |
| `fix:`       | bug fix                                                      |
| `docs:`      | README, AGENTS.md, in-code comments only                     |
| `chore:`     | build deps, lockfile churn, scaffolding                      |
| `test:`      | adds or fixes tests                                          |
| `test+pkg:`  | combined test + packaging change (used for the .rpm landing) |
| `feat(scope):` etc. | use a parenthesised scope when it disambiguates       |

Not strictly enforced. Aim for the *why*, not the *what*, in the body.

## CI expectations

Two workflows live under `.github/workflows/`:

- **`ci.yml`** — runs on every PR / push to `master`/`main`. Runs
  `deno task check` and `deno task test`.
- **`release.yml`** — see *Release process* above. Triggers on tag
  push, on `neutralino.config.json` bumps to `master`/`main`, or via
  `workflow_dispatch`.

Locally, the test suite is split across three layers:

```bash
deno task test:unit         # tests/unit/*.test.ts (pure functions, no IO)
deno task test:integration  # tests/integration/*.test.ts (Deno KV, embeddings)
deno task test:e2e          # tests/0*.test.ts (Puppeteer; spins a real server)
deno task test              # all of the above
```

The e2e suite boots a dev server via `tests/setup.ts` and drives it
with Puppeteer. It needs a working browser binary (Puppeteer fetches
one on `npm install`) and a free port. Don't tag a release if the e2e
suite is red.

## What lives where

- **App version** — `neutralino.config.json` (`.version`). Read at
  build time by `scripts/build.sh` and at runtime by `src/lib/version.ts`.
- **Build scripts** — `scripts/build.sh` builds the shared `AppDir`;
  `scripts/build-deb.sh`, `scripts/build-rpm.sh`, and
  `scripts/build-appimage.sh` are the per-format packagers. The
  unified launcher (the `librenotebook server|window` heredoc) lives
  inside `scripts/build.sh`.
- **Run modes** — server vs window selection happens in the launcher.
  Window mode forces `MULTI_USER=0` *before* the server starts so
  `.env`'s `MULTI_USER=1` cannot take effect. See the heredoc in
  `scripts/build.sh` and the regression test
  `tests/04_settings_lock.test.ts`.
- **Data directories** — `src/lib/paths.ts` (platformdirs-equivalent
  for Linux: `$XDG_DATA_HOME/librenotebook`, etc.).
- **Env schema** — `.env.example` is the source of truth. `src/lib/env-config.ts`
  parses it; `src/lib/settings-guard.ts` decides which onboarding
  fields lock when the corresponding env var is set.
- **Tests** — `tests/` (see *CI expectations* for the layer split).
  Setup helper at `tests/setup.ts`.

## Quick checklist before tagging

- [ ] `deno task check` passes (fmt + lint + type-check)
- [ ] `deno task test` passes (all three layers)
- [ ] `neutralino.config.json` version bumped
- [ ] README and `.env.example` reflect any new knobs
- [ ] Release commit message summarises what's in the release
- [ ] Annotated tag `v<version>` created with `git tag -a`
- [ ] `git push --follow-tags`
