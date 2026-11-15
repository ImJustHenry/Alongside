# Alongside: notes for AI assistants

Read [HANDOFF.md](HANDOFF.md) first. It has the project state, the tested build-and-ship procedure for the Quest, required settings, networking, and known traps.

Hard rules:
- **Never commit** the Android keystore, its password file, APKs, `.env`, or `server/data/`. They're git-ignored; keep it that way.
- **Never hard-code the keystore password** in scripts. Read it at build time from the private file outside the repo (see HANDOFF §4).
- **Bump `bundleVersionCode`** above the last uploaded build (currently 20) for every upload. Verify the APK with `aapt2` and `apksigner` before uploading.
- **Don't run `AlongsideSetup.BuildScene`** or the `Alongside/LiveView` menu items 3 and 5. They reset scene fields.
- **Keep the OpenXR "Composition Layers" feature enabled.** Without it, passthrough renders black.
- **The build scene is `unity/Assets/Scenes/Alongside.unity`**, not `Main.unity`.
- **Never `SetActive(false)` the `Board` GameObject.** It also runs the board controller, pointer input and LiveView; hide only its visual children.
- **Run the server from this repo's `server/`** (`npm start`). The OpenAI key lives only in `server/.env`. Never put keys, pairing codes or the hotspot password in committed files: this repo is public.
- **The iPad app (`ipad/`) needs Xcode on a Mac.** Without one, test its protocol with `server/examples/ipad-sim.mjs` and `npm run fake-quest`, and stop the fake Quest afterwards.
