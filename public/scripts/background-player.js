(() => {
  const player = document.querySelector("[data-music-player]");
  if (!(player instanceof HTMLElement)) return;

  const toggle = player.querySelector("[data-audio-toggle]");
  const previous = player.querySelector("[data-audio-prev]");
  const next = player.querySelector("[data-audio-next]");
  const auto = player.querySelector("[data-audio-auto]");
  const volume = player.querySelector("[data-audio-volume]");
  const title = player.querySelector("[data-track-title]");
  const kicker = player.querySelector("[data-track-kicker]");
  const state = player.querySelector("[data-track-state]");
  const cover = player.querySelector("[data-track-cover]");

  if (!(toggle instanceof HTMLButtonElement)) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const media = new Audio();
  media.preload = "none";

  const tracks = [
    {
      theme: "mortal",
      title: "凡人修仙传",
      kicker: "theme song",
      cover: "/images/mortal-cultivation-hero.png",
      source:
        "/obj_w5zDlMODwrDDiGjCn8Ky_14056898058_a4a2_b658_0572_1784d1ad0bd069775dbb68d4823be1be.mp3",
      base: 146.83,
      intervals: [0, 5, 12, 19],
    },
    {
      theme: "signal",
      title: "Night Signal",
      kicker: "ambient channel",
      cover: "/images/signal-sleeve.png",
      base: 110,
      intervals: [0, 7, 12, 19],
    },
    {
      theme: "signal",
      title: "Warm Drift",
      kicker: "low wave",
      cover: "/images/signal-sleeve.png",
      base: 98,
      intervals: [0, 5, 12, 17],
    },
  ];

  let context;
  let master;
  let delay;
  let feedback;
  let filter;
  let voices = [];
  let timer = 0;
  let trackIndex = 0;
  let isPlaying = false;
  let activeMode = "none";
  let playbackNotice = "";
  let autoEnabled = false;
  let pausedByVisibility = false;

  const setText = () => {
    const track = tracks[trackIndex];
    if (title) title.textContent = track.title;
    if (kicker) kicker.textContent = track.kicker;
    if (cover instanceof HTMLImageElement) cover.src = track.cover;
    if (state) state.textContent = playbackNotice || (isPlaying ? "正在播放背景音乐" : track.source ? "等待播放主题曲" : "等待播放");
    player.dataset.audioMode = activeMode;
    player.dataset.audioSource = track.source ? "external" : "synth";
    toggle.textContent = isPlaying ? "❚❚" : "▶";
    toggle.setAttribute("aria-label", isPlaying ? "暂停背景音乐" : "播放背景音乐");
    if (auto instanceof HTMLButtonElement) {
      auto.classList.toggle("is-active", autoEnabled);
      auto.setAttribute("aria-pressed", String(autoEnabled));
    }
    player.classList.toggle("is-playing", isPlaying);
    player.classList.toggle("is-auto", autoEnabled);
  };

  const ensureGraph = () => {
    if (context) return true;
    if (!AudioContextClass) return false;

    context = new AudioContextClass();
    master = context.createGain();
    delay = context.createDelay(4);
    feedback = context.createGain();
    filter = context.createBiquadFilter();

    master.gain.value = Number(volume instanceof HTMLInputElement ? volume.value : 32) / 100;
    delay.delayTime.value = 0.42;
    feedback.gain.value = 0.22;
    filter.type = "lowpass";
    filter.frequency.value = 1600;
    filter.Q.value = 0.7;

    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(filter);
    filter.connect(master);
    master.connect(context.destination);
    return true;
  };

  const stopVoices = () => {
    window.clearInterval(timer);
    timer = 0;
    voices.forEach(({ oscillator, gain }) => {
      const now = context?.currentTime ?? 0;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.06);
        oscillator.stop(now + 0.2);
      } catch {
        oscillator.disconnect();
      }
    });
    voices = [];
  };

  const stopMedia = () => {
    media.pause();
  };

  const triggerTone = (frequency, delayOffset, duration, level) => {
    if (!context || !delay) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime + delayOffset;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.setValueAtTime(Math.sin(now * 0.7) * 3, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(delay);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.1);
  };

  const schedulePhrase = () => {
    const track = tracks[trackIndex];
    track.intervals.forEach((interval, index) => {
      const frequency = track.base * 2 ** (interval / 12);
      triggerTone(frequency, index * 0.42, 2.6 + index * 0.18, index === 0 ? 0.065 : 0.035);
    });
  };

  const startSynthTrack = async () => {
    if (!ensureGraph()) {
      if (state) state.textContent = "当前浏览器不支持背景音乐";
      toggle.disabled = true;
      return;
    }

    await context.resume();
    stopVoices();
    stopMedia();

    const track = tracks[trackIndex];
    track.intervals.slice(0, 3).forEach((interval, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const frequency = track.base * 2 ** ((interval - 12) / 12);

      oscillator.type = index === 1 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index * 2 - 2;
      gain.gain.value = index === 0 ? 0.028 : 0.014;
      oscillator.connect(gain);
      gain.connect(delay);
      oscillator.start();
      voices.push({ oscillator, gain });
    });

    schedulePhrase();
    timer = window.setInterval(schedulePhrase, 3600);
    activeMode = "synth";
    isPlaying = true;
    setText();
  };

  const startTrack = async () => {
    const track = tracks[trackIndex];
    playbackNotice = "";
    stopVoices();
    stopMedia();

    if (track.source) {
      media.src = track.source;
      media.loop = true;
      media.volume = Number(volume instanceof HTMLInputElement ? volume.value : 32) / 100;
      try {
        await media.play();
        activeMode = "media";
        isPlaying = true;
        setText();
        return;
      } catch {
        playbackNotice = "主题曲加载失败，播放氛围音";
      }
    }

    await startSynthTrack();
  };

  const stopTrack = () => {
    stopMedia();
    stopVoices();
    activeMode = "none";
    playbackNotice = "";
    isPlaying = false;
    setText();
  };

  const switchTrack = async (direction) => {
    trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
    if (isPlaying) await startTrack();
    else setText();
  };

  toggle.addEventListener("click", async () => {
    pausedByVisibility = false;
    if (isPlaying) stopTrack();
    else await startTrack();
  });

  auto?.addEventListener("click", async () => {
    if (!(auto instanceof HTMLButtonElement)) return;
    autoEnabled = !autoEnabled;
    pausedByVisibility = false;
    if (autoEnabled) await startTrack();
    else stopTrack();
    setText();
  });

  previous?.addEventListener("click", () => {
    void switchTrack(-1);
  });

  next?.addEventListener("click", () => {
    void switchTrack(1);
  });

  volume?.addEventListener("input", () => {
    if (!(volume instanceof HTMLInputElement)) return;
    const nextVolume = Number(volume.value) / 100;
    media.volume = nextVolume;
    if (master && context) master.gain.setTargetAtTime(nextVolume, context.currentTime, 0.04);
  });

  media.addEventListener("waiting", () => {
    if (activeMode === "media" && state) state.textContent = "正在缓冲主题曲";
  });

  media.addEventListener("playing", () => {
    if (activeMode === "media" && state) state.textContent = "正在播放背景音乐";
  });

  media.addEventListener("error", () => {
    if (activeMode !== "media") return;
    playbackNotice = "主题曲加载失败，播放氛围音";
    void startSynthTrack();
  });

  window.addEventListener("homepage-theme-change", (event) => {
    const theme = event instanceof CustomEvent ? event.detail?.name : null;
    const nextIndex = tracks.findIndex((track) => track.theme === theme);
    if (nextIndex < 0) return;
    trackIndex = nextIndex;
    if (isPlaying) {
      void startTrack();
      return;
    }
    if (autoEnabled) {
      void startTrack();
      return;
    }
    setText();
  });

  document.addEventListener("visibilitychange", () => {
    if (!autoEnabled) return;
    if (document.hidden && isPlaying) {
      pausedByVisibility = true;
      stopTrack();
      return;
    }
    if (!document.hidden && pausedByVisibility) {
      pausedByVisibility = false;
      void startTrack();
    }
  });

  window.addEventListener("pagehide", stopTrack);
  setText();
})();
