/* global CRS_CASES_DATA, CRS_SITE */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const encodePath = (p) => {
    if (!p) return "";
    return encodeURI(String(p));
  };

  /** 배포(Vercel 등)에서 한글 경로 이미지 로딩: 절대 URL + NFC 정규화 */
  const getBase = () => {
    const p = location.pathname || "/";
    const dir = p.replace(/\/[^/]*$/, "") || "";
    return location.origin + dir + (dir.endsWith("/") ? "" : "/");
  };
  const imageUrl = (p) => {
    if (!p) return "";
    const path = String(p).normalize("NFC");
    return getBase() + encodeURI(path);
  };

  const titleToTags = (title) => {
    if (!title) return [];
    return title
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(1); // 첫 토큰은 보통 브랜드/아이템명, 나머지는 공정
  };

  const getParam = (key) => new URLSearchParams(location.search).get(key);

  /** 가격 문자열에서 숫자(만원 단위) 추출. "80,000원" -> 8, "15,000원~30,000원" -> 1.5 (최소값) */
  const priceToBand = (priceStr) => {
    if (!priceStr || typeof priceStr !== "string") return null;
    const match = priceStr.replace(/,/g, "").match(/(\d+)/);
    if (!match) return null;
    return Math.floor(Number(match[1]) / 10000);
  };

  /** 가격 밴드에 해당하는지. bandKey: "ALL" | "~5" | "5~10" | "10~15" | "15~" */
  const matchPriceBand = (casePrice, bandKey) => {
    if (bandKey === "ALL") return true;
    const band = priceToBand(casePrice);
    if (band == null) return bandKey === "ALL";
    if (bandKey === "~5") return band <= 5;
    if (bandKey === "5~10") return band > 5 && band <= 10;
    if (bandKey === "10~15") return band > 10 && band <= 15;
    if (bandKey === "15~") return band > 15;
    return true;
  };

  const normalizeCategory = (cat) => {
    if (!cat) return "기타";
    if (cat.includes("가방")) return "가방/지갑";
    if (cat.includes("주얼")) return "주얼리";
    return cat.replaceAll("_", "/");
  };

  const safeText = (s) => (s == null ? "" : String(s));

  function renderFooter() {
    const el = $("#contactText");
    if (!el) return;

    const brand = (window.CRS_SITE && CRS_SITE.brand) || "까사트레이드 CRS";
    const phone = (window.CRS_SITE && CRS_SITE.phone) || "02-6959-9640";
    const email = (window.CRS_SITE && CRS_SITE.email) || "casatrade.kr@gmail.com";

    el.textContent = `${brand} · 문의: ${phone} · ${email}`;
  }

  // ---------- Lightbox (popup) ----------
  const lightbox = {
    isOpen: false,
    items: [],
    idx: 0,
    open(items, idx, caption) {
      const root = $("#lightbox");
      if (!root) return;
      this.isOpen = true;
      this.items = items || [];
      this.idx = Math.max(0, Math.min(Number(idx || 0), Math.max(0, this.items.length - 1)));

      root.setAttribute("aria-hidden", "false");
      const img = $("#lightboxImg");
      const title = $("#lightboxTitle");
      if (title) title.textContent = caption || "이미지 보기";
      if (img && this.items.length) img.src = imageUrl(this.items[this.idx]);

      document.body.style.overflow = "hidden";
    },
    close() {
      const root = $("#lightbox");
      if (!root) return;
      this.isOpen = false;
      root.setAttribute("aria-hidden", "true");
      const img = $("#lightboxImg");
      if (img) img.src = "";
      document.body.style.overflow = "";
    },
    next() {
      if (!this.isOpen || this.items.length === 0) return;
      this.idx = (this.idx + 1) % this.items.length;
      const img = $("#lightboxImg");
      if (img) img.src = imageUrl(this.items[this.idx]);
    },
    prev() {
      if (!this.isOpen || this.items.length === 0) return;
      this.idx = (this.idx - 1 + this.items.length) % this.items.length;
      const img = $("#lightboxImg");
      if (img) img.src = imageUrl(this.items[this.idx]);
    },
  };

  function bindLightbox() {
    const root = $("#lightbox");
    if (!root) return;

    const closeBtn = $("#lightboxClose");
    const prevBtn = $("#lightboxPrev");
    const nextBtn = $("#lightboxNext");

    closeBtn?.addEventListener("click", () => lightbox.close());
    prevBtn?.addEventListener("click", () => lightbox.prev());
    nextBtn?.addEventListener("click", () => lightbox.next());

    root.addEventListener("click", (e) => {
      if (e.target === root) lightbox.close();
    });

    document.addEventListener("keydown", (e) => {
      if (!lightbox.isOpen) return;
      if (e.key === "Escape") lightbox.close();
      if (e.key === "ArrowRight") lightbox.next();
      if (e.key === "ArrowLeft") lightbox.prev();
    });
  }

  function openImageNewTab(url) {
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : getBase() + encodePath(url);
    window.open(href, "_blank", "noopener,noreferrer");
  }

  // ---------- Index ----------
  function initIndex() {
    const listEl = $("#caseList");
    if (!listEl) return;

    const data = window.CRS_CASES_DATA;
    const cases = (data && data.cases) || [];

    const statCases = $("#statCases");
    const statBefore = $("#statBefore");
    const statAfter = $("#statAfter");

    if (statCases) statCases.textContent = String(cases.length);
    if (statBefore) statBefore.textContent = String(cases.reduce((a, c) => a + (c.beforeImages?.length || 0), 0));
    if (statAfter) statAfter.textContent = String(cases.reduce((a, c) => a + (c.afterImages?.length || 0), 0));

    const searchInput = $("#searchInput");
    const pills = $$(".pill[data-cat]");
    const filterPriceEl = $("#filterPrice");
    const filterRepairEl = $("#filterRepair");

    let activeCategory = "ALL";
    let activePriceBand = "ALL";
    let activeRepair = "ALL";
    let query = "";

    // 수선 종류 = 대분류만 (세탁, 염색, 도금, 복원, 기타)
    const REPAIR_CATEGORY_LABELS = [
      ["세탁", "세탁"],
      ["염색", "염색"],
      ["도금", "도금"],
      ["복원", "복원"],
      ["기타", "기타"],
    ];
    const repairCategoriesUsed = [...new Set(cases.flatMap((c) => c.repairCategories || []))];
    const repairPillList = REPAIR_CATEGORY_LABELS.filter(([key]) => repairCategoriesUsed.includes(key));

    function matchCase(c) {
      const cat = normalizeCategory(c.category);
      const hay = `${safeText(c.title)} ${safeText(c.productName)} ${safeText(c.category)} ${safeText(c.repairType)} ${(c.repairCategories || []).join(" ")} ${cat}`.toLowerCase();
      const okQuery = !query || hay.includes(query.toLowerCase());
      const okCat = activeCategory === "ALL" || cat === activeCategory;
      const okPrice = matchPriceBand(c.price, activePriceBand);
      const okRepair = activeRepair === "ALL" || (c.repairCategories && c.repairCategories.includes(activeRepair));
      return okQuery && okCat && okPrice && okRepair;
    }

    function buildFilterPills() {
      if (filterPriceEl) {
        const bands = [
          ["ALL", "전체"],
          ["~5", "~5만원"],
          ["5~10", "5~10만원"],
          ["10~15", "10~15만원"],
          ["15~", "15만원~"],
        ];
        filterPriceEl.innerHTML = bands
          .map(
            ([key, label]) =>
              `<button class="pill pill-filter" type="button" aria-pressed="${key === "ALL"}" data-price-band="${key}">${label}</button>`
          )
          .join("");
      }
      if (filterRepairEl) {
        filterRepairEl.innerHTML =
          `<button class="pill pill-filter" type="button" aria-pressed="true" data-repair="ALL">전체</button>` +
          repairPillList
            .map(
              ([key, label]) =>
                `<button class="pill pill-filter" type="button" aria-pressed="false" data-repair="${encodeURIComponent(key)}">${safeText(label)}</button>`
            )
            .join("");
      }
    }

    function render() {
      const filtered = cases.filter(matchCase);

      const empty = $("#emptyState");
      if (empty) empty.style.display = filtered.length ? "none" : "block";

      listEl.innerHTML = filtered
        .map((c) => {
          const cat = normalizeCategory(c.category);
          const cover = c.coverImage ? imageUrl(c.coverImage) : "";
          const beforeN = c.beforeImages?.length || 0;
          const afterN = c.afterImages?.length || 0;
          const galleryN = c.galleryImages?.length || 0;
          const meta = beforeN || afterN ? `전 ${beforeN} · 후 ${afterN}` : `사진 ${galleryN}`;
          const badgeClass = cat === "주얼리" ? "badge accent" : "badge";
          const cardTitle = c.productName ? safeText(c.productName) : safeText(c.title);
          const priceHtml = c.price ? `<span class="meta-chip price-chip">${safeText(c.price)}</span>` : "";
          const workChips = (c.repairCategories || []).map((rc) => `<span class="meta-chip work-chip">${safeText(rc)}</span>`).join("");
          const workDetail = c.repairType ? `<div class="card-work-detail">${safeText(c.repairType)}</div>` : "";
          const isHeic = !!c.coverIsHeic;
          const fallbackMsg = isHeic ? "HEIC 파일은 Chrome 등 일부 브라우저에서 표시되지 않을 수 있습니다.<br /><button class=\"media-link\" type=\"button\" data-href=\"" + cover + "\">원본 열기</button>" : "이미지를 불러올 수 없습니다.<br /><button class=\"media-link\" type=\"button\" data-href=\"" + cover + "\">원본 열기</button>";

          return `
            <a class="card" href="./case.html?slug=${encodeURIComponent(c.slug)}" aria-label="${safeText(cardTitle)} 상세 보기">
              <div class="card-media${isHeic ? " is-heic" : ""}">
                <span class="${badgeClass}">${cat}</span>
                ${
                  cover
                    ? `<img src="${cover}" alt="${safeText(cardTitle)}" loading="lazy" data-media="true"
                          onerror="this.closest('.card-media') && this.closest('.card-media').classList.add('broken')" />
                       <div class="media-fallback">
                         ${fallbackMsg}
                       </div>`
                    : ""
                }
              </div>
              <div class="card-body">
                <div class="card-title">${cardTitle}</div>
                <div class="card-chips">
                  ${priceHtml}
                  ${workChips ? `<span class="card-work">${workChips}</span>` : ""}
                </div>
                <div class="card-meta">
                  <span class="meta-chip">${meta}</span>
                  <span class="card-detail-link">상세보기 →</span>
                </div>
                ${workDetail}
              </div>
            </a>
          `;
        })
        .join("");

      // NOTE: 에러 폴백은 inline onerror로 처리(에러가 너무 빨리 발생해도 잡히도록)

      // 2026: cards reveal on scroll
      $$(".card", listEl).forEach((el) => el.classList.add("reveal"));
      if ("IntersectionObserver" in window) {
        const io =
          render._io ||
          (render._io = new IntersectionObserver(
            (entries) => {
              entries.forEach((ent) => {
                if (ent.isIntersecting) {
                  ent.target.classList.add("in");
                  render._io.unobserve(ent.target);
                }
              });
            },
            { threshold: 0.12 }
          ));
        $$(".card", listEl).forEach((el) => io.observe(el));
      } else {
        $$(".card", listEl).forEach((el) => el.classList.add("in"));
      }
    }

    // 중첩 <a> 금지: 카드(<a>) 내부에서는 버튼으로 새탭 열기
    listEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".media-link");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const href = btn.getAttribute("data-href");
      if (href) openImageNewTab(href);
    });

    pills.forEach((p) => {
      p.addEventListener("click", () => {
        pills.forEach((x) => x.setAttribute("aria-pressed", "false"));
        p.setAttribute("aria-pressed", "true");
        activeCategory = p.getAttribute("data-cat") || "ALL";
        render();
      });
    });

    buildFilterPills();

    $("#filterPrice")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill[data-price-band]");
      if (!btn) return;
      $$(".pill[data-price-band]").forEach((x) => x.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      activePriceBand = btn.getAttribute("data-price-band") || "ALL";
      render();
    });

    $("#filterRepair")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill[data-repair]");
      if (!btn) return;
      $$(".pill[data-repair]").forEach((x) => x.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      activeRepair = decodeURIComponent(btn.getAttribute("data-repair") || "ALL");
      render();
    });

    searchInput?.addEventListener("input", () => {
      query = searchInput.value.trim();
      render();
    });

    render();
  }

  // ---------- Case detail ----------
  function initCase() {
    const root = $("#caseRoot");
    if (!root) return;

    const data = window.CRS_CASES_DATA;
    const cases = (data && data.cases) || [];
    const slug = getParam("slug");
    const found = cases.find((c) => c.slug === slug);

    if (!found) {
      root.innerHTML = `<div class="panel"><h2>케이스를 찾을 수 없습니다</h2><p style="color:var(--muted);font-weight:700;">목록으로 돌아가 다시 선택해주세요.</p><div style="margin-top:12px;"><a class="btn" href="./index.html">목록으로</a></div></div>`;
      return;
    }

    const caseDisplayTitle = found.productName ? safeText(found.productName) : found.title;
    const titleEl = $("#caseTitle");
    const catEl = $("#caseCategory");
    if (titleEl) titleEl.textContent = caseDisplayTitle;
    if (catEl) catEl.textContent = normalizeCategory(found.category);

    const chipWrap = $("#caseChips");
    if (chipWrap) {
      const chips = [
        `<span class="chip accent">${normalizeCategory(found.category)}</span>`,
        ...(found.price ? [`<span class="chip price-chip">${safeText(found.price)}</span>`] : []),
        ...((found.repairCategories || []).map((rc) => `<span class="chip repair-chip">${safeText(rc)}</span>`)),
      ];
      chipWrap.innerHTML = chips.join("");
    }

    const before = found.beforeImages || [];
    const after = found.afterImages || [];
    const gallery = found.galleryImages || [];

    const beforeEl = $("#beforeGallery");
    const afterEl = $("#afterGallery");
    const singleEl = $("#singleGallery");
    const pairPanel = $("#pairPanel");
    const singlePanel = $("#singlePanel");

    const allPairItems = [...before, ...after];
    const allSingleItems = [...gallery];

    function thumbs(items, caption) {
      return items
        .map((src, i) => {
          const encoded = imageUrl(src);
          return `
            <div class="thumb" role="button" tabindex="0" aria-label="이미지 확대 보기" data-idx="${i}" data-caption="${safeText(caption)}">
              <img src="${encoded}" alt="${safeText(caption)}" loading="lazy" data-media="true"
                   onerror="this.closest('.thumb') && this.closest('.thumb').classList.add('broken')" />
              <div class="media-fallback">
                이미지가 브라우저에서 열리지 않습니다.<br />
                <button class="media-link" type="button" data-href="${encoded}">원본 열기</button>
              </div>
            </div>
          `;
        })
        .join("");
    }

    if (before.length && after.length) {
      if (pairPanel) pairPanel.style.display = "block";
      if (singlePanel) singlePanel.style.display = "none";

      if (beforeEl) beforeEl.innerHTML = thumbs(before, "전(수선 전)");
      if (afterEl) afterEl.innerHTML = thumbs(after, "후(수선 후)");

      // 각 컬럼 클릭 시: 팝업(라이트박스)으로 열기
      beforeEl?.addEventListener("click", (e) => {
        if (e.target.closest(".media-link")) return;
        const t = e.target.closest(".thumb");
        if (!t) return;
        const idx = Number(t.getAttribute("data-idx") || "0");
        lightbox.open(before, idx, found.title);
      });
      afterEl?.addEventListener("click", (e) => {
        if (e.target.closest(".media-link")) return;
        const t = e.target.closest(".thumb");
        if (!t) return;
        const idx = Number(t.getAttribute("data-idx") || "0");
        lightbox.open(after, idx, found.title);
      });
    } else {
      if (pairPanel) pairPanel.style.display = "none";
      if (singlePanel) singlePanel.style.display = "block";

      const items = allSingleItems.length ? allSingleItems : allPairItems;
      if (singleEl) singleEl.innerHTML = thumbs(items, "작업 이미지");

      singleEl?.addEventListener("click", (e) => {
        if (e.target.closest(".media-link")) return;
        const t = e.target.closest(".thumb");
        if (!t) return;
        const idx = Number(t.getAttribute("data-idx") || "0");
        lightbox.open(items, idx, found.title);
      });
    }

    // NOTE: 에러 폴백은 inline onerror로 처리

    // 썸네일 내부 폴백 버튼 클릭 시: 라이트박스 대신 새탭 열기
    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".media-link");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const href = btn.getAttribute("data-href");
      if (href) openImageNewTab(href);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderFooter();
    bindLightbox();
    initIndex();
    initCase();
  });
})();


