import hashlib
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
SAFE_SUBDIR = "_safe"
SAFE_DIR = WEB_DIR / SAFE_SUBDIR

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
    # 세탁 계열: 세척/오염세척/복원세척/폴리싱/광택 포함
    if (
        "세척" in r
        or "세탁" in r
        or "오염세척" in r
        or "복원세척" in r
        or "폴리싱" in r
        or "광택" in r
    ):
        cats.add("세탁")
    # 염색 계열
    if "염색" in r or "복원염색" in r or "부분복원염색" in r or "전체복원염색" in r:
        cats.add("염색")
    # 도금 계열
    if "도금" in r or "화이트도금" in r or "골드도금" in r or "부분도금" in r:
        cats.add("도금")
    # 복원 계열 (염색과 겹치면 염색 우선)
    if (
        ("복원" in r and "염색" not in r)
        or "엣지코트" in r
        or "모서리" in r
        or "가죽" in r
        or "핸들" in r
        or "보강" in r
        or "뜯어짐" in r
        or "수선" in r
    ):
        cats.add("복원")
    # 기타 계열
    if (
        "큐빅" in r
        or "악세사리" in r
        or "에나멜" in r
        or "땜" in r
        or "연결" in r
        or "제거" in r
        or "스크래치" in r
        or "로고" in r
        or "음각" in r
        or "도색" in r
        or "줄" in r
    ):
        cats.add("기타")
    if not cats:
        cats.add("기타")
    return sorted(cats)


def parse_folder_meta(folder_name: str) -> tuple[str | None, str | None, str | None]:
    """폴더명을 파싱해 (가격, 수선종류, 제품명) 반환."""
    name = nfc(folder_name).strip()
    # 일부 입력은 "-" 대신 "_"를 구분자로 사용
    parts = [p.strip() for p in re.split(r"\s*[-_]\s*", name) if p.strip()]
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


def convert_heic_to_jpg(heic_path: Path, out_path: Path) -> bool:
    """HEIC를 JPG로 변환해 지정 경로에 저장. macOS(sips) 필요."""
    if not shutil.which("sips"):
        return False
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(heic_path.resolve()), "--out", str(out_path)],
            check=True,
            capture_output=True,
            timeout=30,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, OSError, Exception):
        return False


def write_image_safe(src_path: Path, out_path: Path) -> bool:
    """이미지를 안전한(ASCII) 경로로 복사/변환."""
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if src_path.suffix.lower() == ".heic":
            return convert_heic_to_jpg(src_path, out_path)
        shutil.copy2(src_path, out_path)
        return True
    except OSError:
        return False


def collect_case_images(case_dir: Path, case_id: str) -> dict:
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

        def store(kind: str, idx: int) -> str:
            ext = ".jpg" if f.suffix.lower() == ".heic" else f.suffix.lower()
            safe_name = f"{kind}-{idx}{ext}"
            out_path = SAFE_DIR / case_id / safe_name
            ok = write_image_safe(f, out_path)
            if not ok:
                # 실패 시 원본 경로로 폴백 (브라우저에서 안 보일 수 있음)
                return rel_from_portfolio(f)
            return f"web/{SAFE_SUBDIR}/{case_id}/{safe_name}"

        # 폴더 구조마다 네이밍이 다르므로 최대한 폭넓게 지원
        # - '전/후' 또는 'before/after'
        # - 'A/B' (많이 쓰는 전=A, 후=B)
        if "전" in fname or re.search(r"(?i)\bbefore\b", fname):
            before.append(store("before", len(before) + 1))
        elif "후" in fname or re.search(r"(?i)\bafter\b", fname):
            after.append(store("after", len(after) + 1))
        elif re.match(r"(?i)^\s*A[\s_-]*\d", fname):
            before.append(store("before", len(before) + 1))
        elif re.match(r"(?i)^\s*B[\s_-]*\d", fname):
            after.append(store("after", len(after) + 1))
        else:
            gallery.append(store("gallery", len(gallery) + 1))

    return {"before": before, "after": after, "gallery": gallery}


def build_cases(scan_roots: list[tuple[str, Path, str]]):
    cases = []
    slug_counts: dict[str, int] = {}

    for category_label, root, source_key in scan_roots:
        if not root.exists() or not root.is_dir():
            continue

        for case_dir in sorted([d for d in root.iterdir() if d.is_dir()], key=lambda p: nfc(p.name)):
            title = nfc(case_dir.name).replace("_", " · ")
            price, repair_type, product_name = parse_folder_meta(case_dir.name)
            repair_cats = repair_to_categories(repair_type) if repair_type else []

            base_slug = slugify(f"{category_label}-{title}")
            slug_counts[base_slug] = slug_counts.get(base_slug, 0) + 1
            slug = base_slug if slug_counts[base_slug] == 1 else f"{base_slug}-{slug_counts[base_slug]}"

            # root가 여러 개인 경우(예: 2026-01 추가)에도 case_id 충돌 방지
            case_id_src = f"{source_key}/{case_dir.name}"
            case_id = "case-" + hashlib.sha1(case_id_src.encode("utf-8")).hexdigest()[:10]
            imgs = collect_case_images(case_dir, case_id)
            before, after, gallery = imgs["before"], imgs["after"], imgs["gallery"]
            if not (before or after or gallery):
                continue

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
        ("가방_지갑", PORTFOLIO_ROOT / "가방_지갑", "가방_지갑"),
        ("주얼리", PORTFOLIO_ROOT / "주얼리", "주얼리"),
        ("가방_지갑", PORTFOLIO_ROOT / "2026-01" / "가방_지갑", "2026-01/가방_지갑"),
        ("주얼리", PORTFOLIO_ROOT / "2026-01" / "주얼리", "2026-01/주얼리"),
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
