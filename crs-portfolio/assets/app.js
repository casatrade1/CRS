/* global CRS_CASES_DATA, CRS_SITE */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const encodePath = (p) => encodeURI(p);

  const titleToTags = (title) => {
    if (!title) return [];
    return title
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(1); // 첫 토큰은 보통 브랜드/아이템명, 나머지는 공정
  };

  const getParam = (key) => new URLSearchParams(location.search).get(key);

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
      if (img && this.items.length) img.src = encodePath(this.items[this.idx]);

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
      if (img) img.src = encodePath(this.items[this.idx]);
    },
    prev() {
      if (!this.isOpen || this.items.length === 0) return;
      this.idx = (this.idx - 1 + this.items.length) % this.items.length;
      const img = $("#lightboxImg");
      if (img) img.src = encodePath(this.items[this.idx]);
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
    window.open(encodePath(url), "_blank", "noopener,noreferrer");
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
    const pills = $$(".pill");

    let activeCategory = "ALL";
    let query = "";

    function matchCase(c) {
      const cat = normalizeCategory(c.category);
      const hay = `${safeText(c.title)} ${safeText(c.category)} ${cat}`.toLowerCase();
      const okQuery = !query || hay.includes(query.toLowerCase());
      const okCat = activeCategory === "ALL" || cat === activeCategory;
      return okQuery && okCat;
    }

    function render() {
      const filtered = cases.filter(matchCase);

      const empty = $("#emptyState");
      if (empty) empty.style.display = filtered.length ? "none" : "block";

      listEl.innerHTML = filtered
        .map((c) => {
          const cat = normalizeCategory(c.category);
          const cover = c.coverImage ? encodePath(c.coverImage) : "";
          const beforeN = c.beforeImages?.length || 0;
          const afterN = c.afterImages?.length || 0;
          const galleryN = c.galleryImages?.length || 0;
          const meta = beforeN || afterN ? `전 ${beforeN} · 후 ${afterN}` : `사진 ${galleryN}`;
          const badgeClass = cat === "주얼리" ? "badge accent" : "badge";

          return `
            <a class="card" href="./case.html?slug=${encodeURIComponent(c.slug)}" aria-label="${safeText(c.title)} 상세 보기">
              <div class="card-media">
                <span class="${badgeClass}">${cat}</span>
                ${
                  cover
                    ? `<img src="${cover}" alt="${safeText(c.title)}" loading="lazy" data-media="true"
                          onerror="this.closest('.card-media') && this.closest('.card-media').classList.add('broken')" />
                       <div class="media-fallback">
                         이미지가 브라우저에서 열리지 않습니다.<br />
                         <button class="media-link" type="button" data-href="${cover}">원본 열기</button>
                       </div>`
                    : ""
                }
              </div>
              <div class="card-body">
                <div class="card-title">${safeText(c.title)}</div>
                <div class="card-meta">
                  <span class="meta-chip">${meta}</span>
                  <span>상세보기 →</span>
                </div>
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

    const titleEl = $("#caseTitle");
    const catEl = $("#caseCategory");
    if (titleEl) titleEl.textContent = found.title;
    if (catEl) catEl.textContent = normalizeCategory(found.category);

    const chipWrap = $("#caseChips");
    if (chipWrap) {
      const tags = titleToTags(found.title);
      chipWrap.innerHTML = [
        `<span class="chip accent">${normalizeCategory(found.category)}</span>`,
        ...tags.map((t) => `<span class="chip">${safeText(t)}</span>`),
      ].join("");
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
          const encoded = encodePath(src);
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


