(() => {
  const input = document.querySelector("[data-search-input]");
  const searchBox = input instanceof HTMLInputElement ? input.closest(".search-box") : null;
  const cards = Array.from(document.querySelectorAll("[data-content-card]"));
  const filters = Array.from(document.querySelectorAll(".channel-card[data-filter]"));

  let activeType = "all";
  if (new URLSearchParams(window.location.search).has("type")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("type");
    window.history.replaceState({}, "", url);
  }

  const apply = () => {
    const query = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : "";
    searchBox?.classList.toggle("has-query", Boolean(query));

    filters.forEach((button) => {
      button.classList.toggle("is-active", activeType !== "all" && button.dataset.filter === activeType);
    });

    cards.forEach((card) => {
      const type = card.getAttribute("data-type");
      const text = card.textContent?.toLowerCase() || "";
      const matchesType = activeType === "all" || type === activeType;
      const matchesQuery = !query || text.includes(query);
      card.toggleAttribute("hidden", !(matchesType && matchesQuery));
    });
  };

  filters.forEach((button) => {
    button.addEventListener("click", () => {
      const nextType = button.dataset.filter || "all";
      activeType = activeType === nextType ? "all" : nextType;
      const url = new URL(window.location.href);
      if (activeType === "all") url.searchParams.delete("type");
      else url.searchParams.set("type", activeType);
      window.history.replaceState({}, "", url);
      apply();
    });
  });

  input?.addEventListener("input", apply);
  apply();
})();
