(() => {
  const root = document.querySelector("[data-theme-root]");
  const switcher = document.querySelector("[data-theme-switcher]");
  if (!(root instanceof HTMLElement) || !(switcher instanceof HTMLElement)) return;

  const visual = root.querySelector("[data-theme-visual]");
  const kicker = root.querySelector("[data-theme-kicker]");
  const title = root.querySelector("[data-theme-title]");
  const titleArt = root.querySelector("[data-theme-title-art]");
  const titleText = root.querySelector("[data-theme-title-text]");
  const remark = root.querySelector("[data-theme-remark]");
  const buttons = Array.from(switcher.querySelectorAll("[data-theme-target]"));

  const themes = {
    mortal: {
      image: "/images/mortal-cultivation-hero.png",
      alt: "修仙题材角色掐诀施法的最近关注主视觉",
      kicker: "recent focus / animation",
      title: "凡人修仙传",
      titleArt: "/images/title-mortal-wordmark.png",
      remark: "最近在追的修仙动画。最吸引我的是克制、谨慎和一步步积累出来的力量感。",
      audioTitle: "凡人修仙传",
      audioKicker: "theme song",
      audioCover: "/images/mortal-cultivation-hero.png",
    },
    signal: {
      image: "/images/signal-sleeve.png",
      alt: "抽象信号波纹和暗色纸面纹理",
      kicker: "personal signal",
      title: "个人信号",
      titleArt: "/images/title-signal-wordmark.png",
      remark: "回到内容索引本身，把笔记、影像和作品整理成一条可持续更新的个人线索。",
      audioTitle: "Night Signal",
      audioKicker: "ambient channel",
      audioCover: "/images/signal-sleeve.png",
    },
  };

  const applyTheme = (name) => {
    const theme = themes[name] || themes.mortal;
    root.dataset.theme = name;

    if (visual instanceof HTMLImageElement) {
      visual.src = theme.image;
      visual.alt = theme.alt;
    }
    if (kicker) kicker.textContent = theme.kicker;
    if (title instanceof HTMLElement) title.setAttribute("aria-label", theme.title);
    if (titleText) titleText.textContent = theme.title;
    if (titleArt instanceof HTMLImageElement) {
      titleArt.src = theme.titleArt;
      titleArt.alt = theme.title;
    } else if (title) {
      title.textContent = theme.title;
    }
    if (remark) remark.textContent = theme.remark;

    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-theme-target") === name);
    });

    window.dispatchEvent(
      new CustomEvent("homepage-theme-change", {
        detail: {
          name,
          title: theme.audioTitle,
          kicker: theme.audioKicker,
          cover: theme.audioCover,
        },
      }),
    );
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.getAttribute("data-theme-target") || "mortal");
    });
  });

  applyTheme("mortal");
})();
