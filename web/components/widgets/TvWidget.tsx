"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { t } from "../../lib/i18n";

// Direct HLS streams from each channel's own free, publicly reachable CDN —
// no YouTube involved, so no embed/consent-wall restrictions. Verified live.
const CHANNELS = [
  { id: "bloomberg", label: "Bloomberg TV", url: "https://liveprodusphoenixeast.global.ssl.fastly.net/USPhx-HD/Channel-TX-USPhx-AWS-virginia-1/Source-USPhx-16k-1-s6lk2-BP-07-02-81ykIWnsMsg_live.m3u8" },
  { id: "yahoo", label: "Yahoo Finance", url: "https://d1ewctnvcwvvvu.cloudfront.net/playlist.m3u8" },
  { id: "ndtv", label: "NDTV Profit", url: "https://ndtvprofit.akamaized.net/hls/live/2107404/ndtvprofit/master_1.m3u8" },
] as const;

export default function TvWidget() {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>(CHANNELS[0]);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    if (Hls.isSupported()) {
      // Stay a few segments behind the live edge so brief CDN hiccups don't stall playback.
      const hls = new Hls({ liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 10, maxBufferLength: 30 });
      let failures = 0;
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        failures = 0;
        setError(null);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (++failures > 5) {
          setError(t("Stream unavailable right now ({d}). Try another channel.", { d: data.details }));
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setTimeout(() => hls.startLoad(), 2000);
        }
      });
      // Watchdog: if playback stops advancing, jump back to the live edge and reload.
      let lastTime = -1;
      const watchdog = setInterval(() => {
        if (!video.paused && video.readyState !== 0 && video.currentTime === lastTime) {
          const live = hls.liveSyncPosition;
          if (live !== null && live !== undefined && isFinite(live)) video.currentTime = live;
          hls.startLoad();
          video.play().catch(() => {});
        }
        lastTime = video.currentTime;
      }, 8000);
      return () => {
        clearInterval(watchdog);
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.play().catch(() => {});
    } else {
      setError(t("Your browser doesn't support HLS playback."));
    }
  }, [channel]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            className={`term-btn ${channel.id === c.id ? "active" : ""}`}
            onClick={() => setChannel(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="relative flex-1 min-h-0 bg-black">
        <video ref={videoRef} className="w-full h-full" autoPlay muted controls playsInline />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center dim bg-black">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
