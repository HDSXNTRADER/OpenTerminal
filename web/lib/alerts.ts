"use client";

let ctx: AudioContext | null = null;

/** Short three-tone chime via WebAudio (no sound file needed). */
export function playAlertSound() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    [880, 1175, 1568].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch {
    // Audio blocked or unsupported; the on-screen toast still shows.
  }
}

/** Desktop notification when the user allowed it; silently skipped otherwise. */
export function notifyDesktop(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
