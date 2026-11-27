# Kettlebell Flow

A mobile-first web app (PWA) that guides you through a kettlebell circuit while the phone camera counts your reps.

- Runs entirely in the browser: pose tracking is on-device (MediaPipe PoseLandmarker, lite model, GPU delegate). No backend, no video leaves the phone.
- Sequences and settings are stored in `localStorage`.
- Works in mobile Safari and Chrome. Camera access needs HTTPS (GitHub Pages provides it) or `localhost`.

## Default sequence

5 rows · 5 cleans · 5 swings · 5 goblet squats · 5 bicep curls · 5 tricep extensions · 5 pullovers · 10 alternating halos · 10 push-ups — 5 rounds, 2:30 rest. Everything is editable.

## Using it

1. **Setup** – pick a sequence, rounds, rest length and the "next exercise" delay (3–10 s). Prop the phone 2–3 m away at about hip height so your whole body is in the picture.
2. **Next-exercise overlay** – covers the camera and shows the exercise, target reps, an animation and a countdown; the exercise is announced by voice. You can change the reps right there.
3. **Counting** – a big rep counter over the camera feed with a skeleton overlay, a beep per rep. If you are not fully in frame you get a "Step back — full body not visible" warning. Reaching the target moves on automatically.
4. **Round complete** – *Rest* (countdown, then the next round starts by itself), *Start next round now* or *Finish*.
5. Always on screen: **+1** (manual rep, also the space bar on a laptop), **Skip exercise**, **Pause / edit**. The pause screen holds the quick edits: reps of the current and the upcoming exercise, delay, rounds, debug mode.

Exercises set to manual (✋) show a **Done** button instead of camera counting; you choose camera or manual per exercise in the sequence editor.

**Pullovers** are the standing version: the bell starts behind the head, comes up and over, finishes at the chest and goes back. A rep counts when the bell reaches the chest.

On the setup screen, tap an exercise in the list to skip it for the workout (tap again to bring it back).

**Halos** are counted when the bell has gone out to one side, behind your head, and reappears on the other side – in either direction. A tally under the counter shows how many started towards your left (L) and right (R); manual +1 taps are listed separately. For the next halo to register, bring the bell back in front of your face (centre) between circles.

## Log, difficulty and progression

Every finished workout is logged on the phone (rounds, reps, minutes) and you rate it from 1 (very easy) to 6 (max effort). Ending a workout early from the pause screen logs what you did. The setup screen shows your day streak, whether today is done, and recent workouts; "Show all" lets you delete entries.

When the last three workouts of a sequence were all completed in full at the current number of rounds and all rated 1 or 2, the setup screen suggests adding a round. Accepting it restarts the count at the new level; "Not now" hides it until after your next workout. The rule lives in `shouldSuggestRound` in `src/history.ts` (`EASY_MAX`, `EASY_RUN`).

The log is stored only in the browser's `localStorage`: clearing site data or uninstalling the app erases it.

## Development

```bash
npm install
npm run dev      # http://localhost:5173 (camera works on localhost)
npm test         # rep counter + detector tests
npm run build    # type-check and build to dist/
```

To test on a phone before deploying you need HTTPS; the simplest route is to deploy to GitHub Pages.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main` or to the initial `claude/kettlebell-flow-pwa-dntwwe` branch (and can be run by hand from the Actions tab). One-time setup:

1. On GitHub open the repository → **Settings → Pages**.
2. Under **Build and deployment → Source** choose **GitHub Actions**.
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually from the **Actions** tab).
4. The app is served at `https://<user>.github.io/<repo>/`. Open it on the phone and use *Add to Home Screen* to install it.

The Vite base path is set automatically: the workflow passes `BASE_PATH=/<repo name>/` to the build, and `vite.config.ts` uses it as `base`. If you rename the repository nothing needs changing. To deploy from another branch, add it under `on.push.branches` in the workflow and allow it under **Settings → Environments → github-pages → Deployment branches**.

## How rep counting works

`src/repCounter.ts` is a generic counter. Per video frame each exercise produces one number, the **signal** (a joint angle or a relative position). The counter:

1. smooths the signal with an exponential moving average,
2. puts it in the **lo** zone (≤ `lo`) or the **hi** zone (≥ `hi`); the gap between the two thresholds is the hysteresis band, where nothing happens,
3. counts a rep on a full cycle – when the signal enters the zone named by `countOn` after having been in the other one,
4. ignores reps that come faster than `minRepMs`,
5. requires the signal to stay past a threshold for a short dwell time (150 ms by default) so single-frame glitches are ignored, and the start position to be held for 0.4 s before counting begins,
6. skips frames where the needed landmarks are not visible (visibility < 0.6 or outside the frame).

Most exercises also have a **posture gate**: the signal only exists while the body is in the position the exercise is done in (plank for push-ups, chest up for squats, standing for curls and pullovers, hinged for rows, elbows overhead for tricep extensions, hands together for swings). Outside it the frame is ignored, so walking into frame or picking up the bell is not counted.

The skeleton colour and the status tag tell you which state you are in: **white / "in position"** – the signal is live and being measured; **amber / "get into position"** – you are visible but outside the posture gate; **red / "not tracking"** – required joints are hidden or out of frame. The skeleton flashes **green** only when a rep is counted. The setup screen shows the build time, so you can check the phone is running the latest deploy.

The exercises live in `src/exercises.ts`:

| Exercise | Signal | lo | hi | Counts on | Confidence |
| --- | --- | --- | --- | --- | --- |
| Push-ups | elbow angle (°) | 105 | 150 | hi (lockout) | high |
| Goblet squats | hip height above knee ÷ shin length | 0.40 | 0.75 | hi (standing) | high |
| Bicep curls | elbow angle (°), more bent arm | 70 | 140 | lo (top of curl) | high |
| Swings | wrist height vs shoulder ÷ torso (0 = shoulder, −1 ≈ hip) | −0.75 | −0.25 | hi (top) | high |
| Tricep extensions | elbow angle (°), only while the elbow is above the shoulder | 95 | 150 | hi (lockout) | medium |
| Rows | wrist height vs hip ÷ torso, higher hand | −0.45 | −0.12 | hi (top of pull) | medium |
| Cleans | wrist height vs shoulder ÷ torso, higher hand | −0.85 | −0.35 | hi (rack) | medium |
| Pullovers (standing) | wrist height vs shoulder ÷ torso, hands together (≈ +0.3 behind the head, ≈ −0.2 at the chest) | −0.08 | 0.20 | lo (bell at the chest) | medium |
| Halos | hands towards the left (+) / right (−) of the nose ÷ shoulder width, hands above shoulders | −0.25 | 0.25 | cross (bell reappears on the other side) | medium |

`high` and `medium` exercises use the camera by default; a `low` one would default to manual. For halos, the centre is the inner half of the gap between `lo` and `hi`. You choose per exercise in the sequence editor.

## Tuning the thresholds on your phone

1. Turn on **Debug mode** on the setup screen (or on the pause screen mid-workout).
2. During a camera-counted exercise a panel shows the live signal value, a bar with the signal (green dot) and the `lo` (blue) / `hi` (amber) thresholds, the current zone, and the frame rate.
3. Do a few slow reps and watch the value at both ends of the movement.
   - **Reps are missed**: the signal is not reaching a threshold. Move that threshold towards the signal with the − / + buttons (for example raise `lo` if you don't go deep enough to cross it).
   - **Double counts or phantom reps**: the thresholds are too close together or sit inside your normal wobble. Widen the gap.
   - **"not visible"**: the joints the exercise needs are hidden or out of frame – step back, improve the light, or turn side-on / face-on as the overlay suggests.
   - **"not in position"**: the body is visible but the exercise's precondition is not met (e.g. elbows not overhead for tricep extensions).
4. Changes apply immediately and are saved per exercise on that device. **reset** returns to the defaults.

Values that work for you can be made the new defaults by editing `lo` / `hi` (and `minRepMs`) of the detector in `src/exercises.ts`. The smoothing factor is `alpha` in `RepCounter` (default 0.4; lower = smoother but laggier).

Tips: good, even light matters more than anything else; avoid a bright window behind you; a frame rate below ~10 fps (older phones) makes fast movements like swings unreliable – use +1 as the fallback.

## Project layout

```
src/repCounter.ts   generic hysteresis rep counter (+ tests)
src/exercises.ts    exercise catalogue and per-exercise signals (+ tests)
src/pose.ts         camera, PoseLandmarker, skeleton drawing, wake lock
src/workout.ts      workout state machine and screen
src/editor.ts       sequence editor
src/main.ts         setup screen
src/figure.ts       animated stick-figure illustrations
src/audio.ts        beeps and speech
public/sw.js        offline cache
```

The MediaPipe WASM runtime is copied from `node_modules` into `public/mediapipe-wasm` at build time; the pose model (~6 MB) is downloaded from Google's model storage on first use and then cached by the service worker.
