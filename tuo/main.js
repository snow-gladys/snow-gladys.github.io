(function () {
  "use strict";

  const data = window.CHAMPIONS_DATA;
  if (!data || !Array.isArray(data.seasons)) {
    document.body.innerHTML = "<p style='padding:40px'>冠军资料读取失败，请检查 champions/players.js。</p>";
    return;
  }

  const track = document.querySelector("#season-track");
  const grid = document.querySelector("#champion-grid");
  const statusLabels = { completed: "已结束", upcoming: "未开始" };

  data.seasons.forEach((season) => {
    const node = document.createElement("div");
    node.className = `season-node ${season.status}`;
    node.innerHTML = `<strong>${season.id}</strong><span>${statusLabels[season.status]}</span>`;
    track.appendChild(node);
  });

  const finalsNode = document.createElement("div");
  finalsNode.className = "season-node upcoming finals";
  finalsNode.innerHTML = "<strong>FINAL</strong><span>冠军赛</span>";
  track.appendChild(finalsNode);

  data.seasons.forEach((season, index) => {
    const card = document.createElement("article");
    card.className = `champion-card ${season.status}`;
    card.style.transitionDelay = `${Math.min(index * 55, 260)}ms`;

    if (season.status === "completed") {
      const visual = season.photo
        ? `<img class="champion-photo" src="champions/${season.photo}" alt="${season.champion}，${season.id} 赛季冠军" loading="lazy" />`
        : `<div class="monogram" aria-hidden="true">${season.champion.slice(0, 1)}</div>`;
      card.innerHTML = `${visual}
        <div class="champion-meta">
          <span class="champion-season">${season.id} CHAMPION</span>
          <h3 class="champion-name">${season.champion}</h3>
          <p class="champion-record">${season.subtitle || "小当家杯赛季冠军"}</p>
        </div>`;
    } else {
      card.innerHTML = `<div class="champion-meta">
          <span class="champion-season">COMING SOON</span>
          <h3 class="champion-name">${season.id}</h3>
          <p class="champion-record">赛季尚未开启</p>
        </div><span class="lock-mark" aria-hidden="true">◇</span>`;
    }
    grid.appendChild(card);
  });

  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }),
    { threshold: 0.12 }
  );

  document.querySelectorAll(".reveal, .champion-card").forEach((element) => observer.observe(element));
  document.querySelector("#year").textContent = new Date().getFullYear();

  const header = document.querySelector(".site-header");
  const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
})();
