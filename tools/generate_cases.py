import json
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path


HERE = Path(__file__).resolve()
PORTFOLIO_ROOT = HERE.parents[1]  # 07_CRS 사이트 폴더
DATA_DIR = PORTFOLIO_ROOT / "data"
WEB_DIR = PORTFOLIO_ROOT / "web"  # HEIC → JPG 변환본 (Chrome 등에서 보이게)

IMG_EXT = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".heic",
    ".JPG",
    ".JPEG",
    ".PNG",
    ".WEBP",
    ".GIF",
    ".HEIC",
}

EXT_PREFERENCE = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"]

KOREAN_RANGES = "\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7A3\uD7B0-\uD7FF"
_slug_re_keep = re.compile(rf"[^0-9A-Za-z\-{KOREAN_RANGES}]+")


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def slugify(s: str) -> str:
    s = nfc(s).strip()
    s = re.sub(r"[\s_]+", "-", s)
    s = _slug_re_keep.sub("", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "case"


# 폴더명에서 가격·수선 종류 파싱 (예: "디올 백-모서리 복원 염색-80,000원")
PRICE_PATTERN = re.compile(r"[\d,~]+원\s*$")

# 세부 수선명 → 대분류 (세탁, 염색, 도금, 복원, 기타) — 염색은 전체/부분 구분 없이 하나로
def repair_to_categories(repair_str: str | None) -> list[str]:
    if not repair_str:
        return []
    r = nfc(repair_str).lower()
    cats = set()
    if "세척" in r or "세탁" in r or "오염세척" in r:
        cats.add("세탁")
    if "염색" in r or "복원염색" in r:
        cats.add("염색")
    if "도금" in r:
        cats.add("도금")
    if "복원" in r and "염색" not in r:
        cats.add("복원")
    if "큐빅" in r or "악세사리" in r or "에나멜" in r or "땜" in r or "연결" in r or "제거" in r or "스크래치" in r or "폴리싱" in r or "광택" in r:
        cats.add("기타")
    if not cats:
        cats.add("기타")
    return sorted(cats)


def parse_folder_meta(folder_name: str) -> tuple[str | None, str | None, str | None]:
    """폴더명을 파싱해 (가격, 수선종류, 제품명) 반환."""
    name = nfc(folder_name).strip()
    parts = [p.strip() for p in name.split("-") if p.strip()]
    if len(parts) < 2:
        return None, None, parts[0] if parts else None
    product_name = parts[0]
    price = None
    repair = None
    if PRICE_PATTERN.search(parts[-1]):
        price = parts[-1]
        if len(parts) > 2:
            repair = " · ".join(parts[1:-1])
    else:
        repair = " · ".join(parts[1:])
    return price, repair, product_name


def rel_from_portfolio(file_path: Path) -> str:
    """포트폴리오 루트 기준 상대 경로 (웹에서 이미지 경로로 사용)."""
    rel = file_path.resolve().relative_to(PORTFOLIO_ROOT.resolve())
    return str(rel).replace("\\", "/")


def convert_heic_to_jpg(heic_path: Path) -> str | None:
    """HEIC를 JPG로 변환해 web/ 아래에 저장. macOS(sips) 필요. 반환: 상대 경로(web/...) 또는 실패 시 None."""
    if not shutil.which("sips"):
        return None
    try:
        rel = heic_path.resolve().relative_to(PORTFOLIO_ROOT.resolve())
        jpg_rel = rel.with_suffix(".jpg")
        out_path = WEB_DIR / jpg_rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(heic_path.resolve()), "--out", str(out_path)],
            check=True,
            capture_output=True,
            timeout=30,
        )
        return "web/" + str(jpg_rel).replace("\\", "/")
    except (subprocess.CalledProcessError, FileNotFoundError, OSError, Exception):
        return None


def collect_case_images(case_dir: Path) -> dict:
    raw_files = [f for f in case_dir.iterdir() if f.is_file() and f.suffix in IMG_EXT]
    # If both HEIC and JPG exist for the same basename, keep only the preferred one.
    by_base: dict[str, list[Path]] = {}
    for f in raw_files:
        base = nfc(f.stem).strip()
        by_base.setdefault(base, []).append(f)

    files: list[Path] = []
    for base, group in by_base.items():
        # pick preferred ext in group
        best = None
        for ext in EXT_PREFERENCE:
            for f in group:
                if f.suffix.lower() == ext:
                    best = f
                    break
            if best is not None:
                break
        files.append(best or group[0])

    files = sorted(files, key=lambda p: nfc(p.name))
    if not files:
        return {"before": [], "after": [], "gallery": []}

    before, after, gallery = [], [], []
    for f in files:
        fname = nfc(f.name)
        rel = rel_from_portfolio(f)
        if f.suffix.lower() == ".heic":
            jpg_rel = convert_heic_to_jpg(f)
            if jpg_rel:
                rel = jpg_rel

        # 폴더 구조마다 네이밍이 다르므로 최대한 폭넓게 지원
        # - '전/후' 또는 'before/after'
        # - 'A/B' (많이 쓰는 전=A, 후=B)
        if "전" in fname or re.search(r"(?i)\bbefore\b", fname):
            before.append(rel)
        elif "후" in fname or re.search(r"(?i)\bafter\b", fname):
            after.append(rel)
        elif re.match(r"(?i)^\s*A[\s_-]*\d", fname):
            before.append(rel)
        elif re.match(r"(?i)^\s*B[\s_-]*\d", fname):
            after.append(rel)
        else:
            gallery.append(rel)

    return {"before": before, "after": after, "gallery": gallery}


def build_cases(scan_roots: list[tuple[str, Path]]):
    cases = []
    slug_counts: dict[str, int] = {}

    for category_label, root in scan_roots:
        if not root.exists() or not root.is_dir():
            continue

        for case_dir in sorted([d for d in root.iterdir() if d.is_dir()], key=lambda p: nfc(p.name)):
            imgs = collect_case_images(case_dir)
            before, after, gallery = imgs["before"], imgs["after"], imgs["gallery"]
            if not (before or after or gallery):
                continue

            title = nfc(case_dir.name).replace("_", " · ")
            price, repair_type, product_name = parse_folder_meta(case_dir.name)
            repair_cats = repair_to_categories(repair_type) if repair_type else []

            base_slug = slugify(f"{category_label}-{title}")
            slug_counts[base_slug] = slug_counts.get(base_slug, 0) + 1
            slug = base_slug if slug_counts[base_slug] == 1 else f"{base_slug}-{slug_counts[base_slug]}"

            cover = (after or before or gallery)[0]
            cover_is_heic = cover.lower().endswith(".heic")

            case_entry = {
                "slug": slug,
                "category": category_label,
                "title": title,
                "coverImage": cover,
                "coverIsHeic": cover_is_heic,
                "beforeImages": before,
                "afterImages": after,
                "galleryImages": gallery,
            }
            if product_name:
                case_entry["productName"] = product_name
            if price:
                case_entry["price"] = price
            if repair_type:
                case_entry["repairType"] = repair_type
            if repair_cats:
                case_entry["repairCategories"] = repair_cats
            cases.append(case_entry)

    return cases


def main():
    scan_roots = [
        ("가방_지갑", PORTFOLIO_ROOT / "가방_지갑"),
        ("주얼리", PORTFOLIO_ROOT / "주얼리"),
    ]

    cases = build_cases(scan_roots)

    out = {
        "generatedFrom": "workspace",
        "caseCount": len(cases),
        "cases": cases,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "cases.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "cases-data.js").write_text(
        "window.CRS_CASES_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )

    print(f"Wrote {DATA_DIR / 'cases.json'} ({len(cases)} cases)")


if __name__ == "__main__":
    main()


