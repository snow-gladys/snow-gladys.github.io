document.addEventListener("DOMContentLoaded", () => {
    // 频谱初始化
    const visualizer = document.getElementById("visualizer");
    if (visualizer) {
        const barCount = 45;
        const fragment = document.createDocumentFragment();

        const peaks = [];
        const numMainPeaks = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < numMainPeaks; i++) {
            peaks.push({
                center: 10 + Math.random() * 25,
                width: 3 + Math.random() * 3,
                height: 0.7 + Math.random() * 0.4
            });
        }
        const numSubPeaks = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < numSubPeaks; i++) {
            peaks.push({
                center: Math.random() * 45,
                width: 3 + Math.random() * 4,
                height: 0.2 + Math.random() * 0.3
            });
        }

        for (let i = 0; i < barCount; i++) {
            let targetHeight = 0.05;

            peaks.forEach(peak => {
                const distance = i - peak.center;
                const effect = Math.exp(-(distance * distance) / (2 * peak.width * peak.width));
                targetHeight += effect * peak.height;
            });

            const globalEnvelope = 0.2 + 0.8 * Math.sin(Math.PI * (i / (barCount - 1)));
            targetHeight = targetHeight * globalEnvelope;

            targetHeight += Math.random() * 0.03;
            targetHeight = Math.min(1, targetHeight);

            const duration = 0.8 + Math.random() * 0.7;

            const bar = document.createElement("div");
            bar.className = "bar";
            bar.style.setProperty("--h", `${targetHeight * 100}%`);
            bar.style.setProperty("--d", `${duration}s`);
            bar.style.animationDelay = `-${Math.random() * 2}s`;

            fragment.appendChild(bar);
        }

        visualizer.appendChild(fragment);
    }

    // 粉丝数逻辑（与现有首页一致的数据源）
    const API_BASE = "https://snow-gladys-api-zone-3msnp1a62hlu-1304656834.eo-edgefunctions.com";
    const fanCountElement = document.getElementById("fan-count");

    async function fetchFanCount() {
        if (!fanCountElement) return;
        try {
            const VMID_SINUO = "3537115310721781";
            const response = await fetch(`${API_BASE}/fans?vmid=${VMID_SINUO}`);
            if (!response.ok) throw new Error();

            const data = await response.json();
            if (data.code === 0 && data.data && typeof data.data.follower === "number") {
                fanCountElement.innerText = data.data.follower.toLocaleString();
            } else {
                fanCountElement.innerText = "---";
            }
        } catch (e) {
            console.error("粉丝数获取失败:", e);
            if (fanCountElement) fanCountElement.innerText = "---";
        }
    }
    fetchFanCount();

    // 按钮行为：先简单跳转到原首页，由原页面负责后续逻辑
    const btnOpenPlaylist = document.getElementById("btn-open-playlist");
    if (btnOpenPlaylist) {
        btnOpenPlaylist.addEventListener("click", () => {
            window.location.href = "index.html";
        });
    }

    const btnPlayRandom = document.getElementById("btn-play-random");
    if (btnPlayRandom) {
        btnPlayRandom.addEventListener("click", () => {
            window.location.href = "index.html";
        });
    }
});

