# Redux Save Studio

Build the editor with `npm run build`, then open the generated **Redux Save Studio.html** in a modern browser. The generated editor is a standalone offline application: no install, server, account, or internet connection is needed to use it. Your save is read and edited only in browser memory.

The editor supports the modern Elite Redux 20-section format and 128 KB `.sav` / `.srm` battery saves. It reads and edits party Pokémon, all 26 PC boxes, game settings, the trainer card, money, PC box names and the bag. It does not convert older save formats.

**Applying changes.** Edits stay on the page until you apply them. While a form has unapplied changes its Apply bar stays pinned to the bottom of the screen, and leaving the page (another tab, Pokémon or box, or exporting) asks whether to apply or discard them. The export button and the Review & export tab show how many changes the save has. On phones the roster folds into a single "Change Pokémon" button, and long pages have section shortcuts; rarely used fields (original trainer, Hidden Power, markings, PC box names) sit in panels that open on demand.

**Adding and organising Pokémon.** **＋ Add Pokémon** builds a new Pokémon (species, level, nature, shininess, moves suggested from its learnset) or imports a pasted Pokémon Showdown set. New Pokémon are created the way the game's `CreateBoxMon` does, with you as the original trainer. Each Pokémon can be moved or swapped between the party and any PC slot, duplicated into the first free slot, released, or copied out as a Showdown set. Pokémon moved into the party are fully healed, as on an in-game withdrawal. The party always keeps at least one Pokémon that is not an Egg. **Heal party** and **Max friendship** act on the whole party.

**Finding Pokémon.** The roster search matches species (including the base species of a form, so `Absol` finds Absol Mega), nickname, type or exact dex number (`#150`). With **Search all boxes and party** ticked it searches the whole party and all 26 PC boxes, shows where each match is stored, and opens it in place; untick it to filter only the list you are viewing. Several words narrow the search (`dragon ground`).

**Showdown import.** Species (including forms such as `Garchomp-Mega`), nickname, item, level, EVs, nature, shininess, happiness, `IVs: 0 Spe` and moves are imported; anything missing from this game's data is skipped with a warning. Abilities come from the PID in Elite Redux, so if the requested ability is not one of the new Pokémon's three choices, the Ability lab opens with it filled in as a search target.

**Species finder.** Choose one to four abilities or innates and get every species that can have all of them at once under your save's randomizer settings, each with a PID that does it, its gender and its types. Filter by type or minimum base stat total, then add any result straight to your party or PC with that PID. Species that share the same ability and innate sources roll identically once the PID is adjusted for the species, so each distinct layout (about 1,400 of them) is searched once, spread over several background workers. One or two abilities take about a second; three or four can take minutes, and results appear as they are found. With the randomizers off it lists the species that have the abilities naturally. The Ability lab's **Fill blanks with current abilities** copies a Pokémon's current ability and innates into the search so you can choose which to keep (every one kept makes matches much rarer, because they all come from the same PID).

**Move and item details.** Each move has a **Details** panel with type, category, power, accuracy, PP (and the maximum with PP Ups), priority, target, effect and effect chance, flags such as contact or sound, and the in-game descriptions. The held item shows its description, the bag is split into the game's real pockets (Items, Medicine, Poké Balls, Battle items, Berries, TMs & HMs, Mega Stones, Key items), and hovering an item shows what it does. Pockets and descriptions come from Elite Redux's [er-config](https://github.com/Elite-Redux/er-config) item data.

**More Pokémon fields.** Original trainer name, trainer/secret ID and gender, met location, language, markings, the Alpha and fateful-encounter flags, and, for party Pokémon, current HP and status condition (sleep, poison, toxic, burn, freeze, paralysis, frostbite, bleed).

**Trainer & bag tab.** Edit your trainer name, gender, Trainer/Secret ID and play time; by default, Pokémon you caught are updated to the new OT so they keep obeying. Edit money (up to ¥999,999), Game Corner coins and Battle Points (up to 9,999), rename all 26 PC boxes, and choose which items you own. Elite Redux stores the bag as one "owned" flag per item with unlimited uses, so items are toggled rather than counted; search, category and owned/missing filters plus bulk add/remove are available.

**Progress tab.** Mark any species as unseen, seen or caught in the Pokédex (caught always implies seen), with search, filters and bulk actions; it changes Pokédex records only. Edit common game statistics (steps, battles, catches, eggs hatched and more), turn the nuzlocke first-encounter rule on or off and clear its route and caught-location tracking, and move the in-game clock forward or back. The roaming Pokémon is shown read-only, because its location exists only while the game runs.

**PC and points.** Choose each box's wallpaper (the 16 standard designs) and which box the PC opens on, and edit the trainer-card Battle Points total alongside spendable BP. Raising spendable BP adds the same amount to the trainer-card total (up to 9,999) unless you change that total yourself.

**Save layout notes.** Elite Redux 2.65.4 stores some data at different positions from the current Elite Redux source (for example, berry trees use 8 bytes each), so every newer field was located against a real 2.65.4 save: game stats match the save counter and step count, every caught Pokédex entry is also seen, the roamer sits immediately before the Pokédex, and the nuzlocke data ends with the start-menu item count. Day Care, mass outbreaks, side quests, berry trees, Pokéblocks, decorations, mail and Battle Frontier streaks are deliberately not editable: their 2.65.4 positions could not be confirmed, or the game stores them in a way that editing could corrupt neighbouring data.

**All option-menu settings.** Besides difficulty, level caps, randomizers and the other run rules, Game settings covers battle speed, overworld speed, text speed, HP bar speed, battle animations, battle style, sound, button mode, window frame, battle UI skin, damage numbers, nickname prompts, player AI, individual colours and double battles.

A Pokémon record the catalog does not recognise no longer prevents a save from opening: it is counted in the status banner and locked, while everything else stays editable.

Features include species, nickname, experience-backed level, nature, EVs, held items, moves (including IDs over 999), current party PP, shiny palette, Poké Ball, friendship, Hidden Power type, egg state, ability slot, and zero Speed IV. Redux's other IVs are fixed at 31, with the game's Hell-mode exception. Party stats are refreshed when relevant fields change. Box Pokémon derive stats on withdrawal.

Ability lab previews and searches abilities and innates derived from PID. It uses native 32-bit arithmetic and inverse LCG enumeration in a cancellable Web Worker. Every displayed result is checked with the forward randomizer. Keep-gender and ability-slot constraints are available. Ability and innate randomizers must be enabled to change their derived results. Mega/form preview does not modify the saved species.

Search matches requested abilities **in any order by default**: each may appear in the active ability or any of the three innate slots. Every entered ability must be present; repeating one requires distinct slots containing that ability. Blank inputs accept any remaining abilities. Uncheck **Match abilities in any order** to require the exact active/innate positions. Fixed abilities, randomizer exclusions, ability-slot selection, and gender constraints remain respected. Results label the active ability and innate order they will actually use.

Pokémon details, Ability lab, PID/form previews, and search results show all three switchable ability choices. The equipped choice is marked separately from the three innates. Change **Equipped ability** in the Pokémon form and apply the changes to select a different choice. Search results mark which choice will be equipped when applied.

The **↻** controls open a searchable ability picker. Current ability choices can be equipped directly. Picking a new randomized ability adds a search target; a verified PID result is still required to apply it. In any-order mode an empty target field is used before replacing an existing entry. Fixed or excluded slots explain why new randomized choices are unavailable.

The picker opens with 40 options, caches its sorted ability data, and loads more as you scroll or click **Show more abilities**. Search always covers the entire ability catalog, including options that have not been displayed yet.

Click anywhere on a search-result row, or focus it and press Enter/Space, to apply that PID. The applied row is marked, earlier results and continuation remain available, and the exact search text and options are preserved. Search drafts are kept separately for each Pokémon during the session.

Pokémon artwork is bundled for all 1,922 catalog species, including forms, in the roster and details header. It works offline and does not send save information to an image host. Artwork comes from the [ER Nextdex sprite collection](https://github.com/ForwardFeed/ER-nextdex/tree/0a254c8edca412eec353f71597e70a2b47262128/static/sprites). Run `node scripts/icons.cjs` to regenerate the bundled image catalog from that pinned source. Downloads must match the SHA-256 hashes in `scripts/sprite-hashes.json`; redirects, oversized responses, and altered files are rejected before the final catalog is replaced. Changing the source snapshot requires reviewing and updating the hash manifest too.

Search loads results in batches of 12. Click **Load more matches** below the results to continue from the saved search position, without rescanning earlier candidates or repeating results. Earlier matches remain available, and **Search complete** appears only when the candidate scan finishes. Changing targets or constraints starts a fresh search. Stop search keeps already loaded matches; starting another search replaces them.

**Game versions.** Two Elite Redux builds are bundled: **2.65.4** (also used by 2.65.4.1b) and **2.65.4.11b**, both from ER Nextdex (October 7 and October 19, 2026 snapshots). Pick yours from **Game version** on the welcome page or next to the file name; the choice is remembered. When a save is opened the editor also guesses the build: Pokémon that know a move only one build has settle it, then a version in the file name (`2.65.4.11b`, `2.65.4.1b`, `2.65.4`, with dots, dashes, underscores or spaces), then party stats cached by the game. It says why when it switches, and you can switch back. A save does not record its ROM build, and the choice matters: the ability randomizer rolls modulo the build's ability count (1,062 outcomes in 2.65.4, 1,073 in 2.65.4.11b, which added 11 abilities), so every randomized ability and innate changes with the version. 2.65.4.11b also updates 184 species, 9 moves and 31 abilities. It is stored as a small patch over the 2.65.4 data (`src/catalog-patches.json`); regenerate either with `node scripts/catalog.cjs <gameData.json> <version> <output.json> [--patch] [--items <er-config>/items]` (`--items` adds bag pockets and item descriptions). Newer or custom ROMs can import a Nextdex gameData JSON with explicit randomizer configuration in Game settings.

The editor checks the save signature, all section IDs, consistent save counters, Pokémon layout and checksums. Damaged/incomplete saves cannot be edited or exported. Exports recalculate checksums, reopen the bytes with the parser, preserve file size and unrelated data, and download a new file, named as you choose in Review & export (by default the original name plus `.edited`). The original is never overwritten. Undo/redo and an original-backup download are available.

1. Save through the **in-game** menu, then fully close the emulator.
2. Open its battery `.sav` / `.srm` here and download an original backup.
3. Edit and click **Apply**; review the changes and export.
4. Place the exported file in the emulator's battery-save folder and rename it to match the ROM. Use the extension expected by your emulator.
5. Boot normally and choose **Continue**. Loading an old savestate can restore old save data.

## Development

No third-party runtime dependencies.

```text
npm run build
npm test
npm start
```

Code style is enforced with Prettier (`.prettierrc.json`); run `npm run format` before committing. The dev server listens on `http://127.0.0.1:4173`. Run the build before starting it. Build produces `dist/index.html` and the standalone editor; both are generated files and are excluded from Git. No dependency installation or network connection is required to build from the included source and data. To run additional integration checks on a real save, set `ER_SAMPLE_FILE` to its absolute path before running tests. Real save files, ROMs, research downloads, and test exports are excluded from Git and deployment.

The repository keeps the application in `src/`, build and maintenance scripts in `scripts/`, and checks in `tests/`. The bundled `src/catalog.json` and `src/icons.json` are required application data. Temporary research files, screenshots, reference-page copies, and deployment archives are not needed to build or run the editor.

The hosted editor supports touch layouts, searchable catalog choosers, and portrait or landscape use on current mobile browsers. On a phone or tablet, select a battery save from the device's file picker; exported saves use the browser's download handling and can be moved through its Downloads or Files app. The hosted page is the most reliable way to open the editor on mobile: some file-preview apps do not execute downloaded HTML.

Optional mobile browser checks use Playwright separately from the dependency-free build and unit tests. Install it with `npm install --no-save --package-lock=false playwright`, install its browsers with `npx playwright install chromium webkit firefox`, build and start the local server, then run `node tests/mobile.browser.cjs` in another terminal. The checks cover phone, tablet, and landscape sizes, file import/export, backups, editing, search pagination, catalog choosers, dialogs, and the offline editor. Screenshots and downloaded fixtures go to the ignored `test-output/mobile/` directory. Engine emulation does not replace testing device-specific keyboards, file pickers, and downloads on physical phones.

The source parser and writer are independently implemented. Public game data and format definitions come from [Elite Redux source](https://github.com/Elite-Redux/eliteredux-source), its [configuration](https://github.com/Elite-Redux/er-config), and [ER Nextdex](https://github.com/ForwardFeed/ER-nextdex). The [reference editor](https://pokemon-elite-redux--srm-editor.pages.dev/) informed the feature scope.

Binary and browser verification can establish export integrity; in-emulator verification requires the matching ROM and emulator. No matching ROM is included with this project.

## GitHub Pages

The included `.github/workflows/pages.yml` runs the tests and builds the editor for pushes and pull requests targeting `main` or `develop`, and for merge queue checks. It can also be started manually from the repository's Actions tab. The site has two environments: **production** at the site root, built from `main`, and a **dev preview** at `/dev/`, built from `develop` with a banner marking it as a preview (and `noindex`, so search engines skip it). A Pages deployment replaces the whole site, so every successful push or manual run on `main` or `develop` checks out both branches, builds each, and publishes them together. Pull requests and other branches only validate the build. The workflow uses GitHub's built-in token and needs no additional secrets or dependency installation. This is the sole Pages deployment workflow; the repository does not use Jekyll.

1. Create a GitHub repository, for example `elite-redux-save-editor`. Use a public repository for GitHub Pages on GitHub Free.
2. Keep the workflows on both `main` and `develop`. Push to `develop` to publish the dev preview at `/dev/`, then merge into `main` to publish production.
3. In the repository, open **Settings → Pages → Build and deployment**, and set **Source** to **GitHub Actions**.
4. Open **Actions → Deploy editor to GitHub Pages**. If the first run started before Pages was enabled, rerun it or use **Run workflow**.
5. After the deployment succeeds, open the URL shown in **Settings → Pages**, normally `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
6. For the dev preview, open **Settings → Environments → github-pages** and make sure **Deployment branches and tags** allows `develop` as well as `main`; otherwise deployments from `develop` are rejected. The preview is then at `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/dev/`.

The editor embeds its assets, so it works under the repository URL without a custom base path. Leave `dist/` and `Redux Save Studio.html` out of Git; the workflow generates them.

GitHub's [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [custom-workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describe this deployment method.

Dependabot checks GitHub Actions and npm dependencies independently on `main` and `develop`. Keep `.github/dependabot.yml` on the default branch (`main`): GitHub reads that copy even for updates targeting `develop`. Dependabot security updates target the default branch; the `develop` entries provide scheduled version updates. See GitHub's [Dependabot configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch).

Repository settings complete the workflow protection: keep Pages set to **GitHub Actions**, restrict the `github-pages` environment's deployment branches to `main`, and use a branch ruleset covering both `main` and `develop` to require the `build`, `Analyze (actions)`, and `Analyze (javascript-typescript)` checks before merging. Keep CodeQL in **Advanced** setup for the committed workflow; disable Default setup if it was previously enabled. Keep private vulnerability reporting enabled so the reporting link in [SECURITY.md](SECURITY.md) remains available. These settings are managed in GitHub and are not applied by committing workflow files. See GitHub's [environment protection guide](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) and [ruleset guide](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).
