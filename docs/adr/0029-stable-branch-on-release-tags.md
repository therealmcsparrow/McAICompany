# `stable` is a branch that only ever points at a release tag

Releases get annotated `vX.Y.Z` tags that never move; `stable` is a branch, because it has to move back on a rollback and moving a tag breaks the clones and caches that already fetched it. Only `scripts/stable.mjs <x.y.z>` moves it, to the commit of an existing annotated release tag that is already on `origin/main` (so it passed the Ship Gate and CI), and `release.mjs` keeps its rule of never touching a remote. This is hard to reverse because installs that follow `stable` key on its name.
