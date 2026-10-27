"""egit: a git-style CLI over the model history in frontend/demo_viewer/models/ (an easter egg).

    ./egit log [--long]            the history, newest first, like git log --graph --oneline
    ./egit show [<version>]        a version's message and its diff against its first parent
    ./egit diff <a> <b> [--stat]   the engine's diff between two versions or two .e2k paths
    ./egit add <file.e2k> -m <summary> [-m <body>] [--parent <v>]... [--author <name>] [--as <name>]
    ./egit status                  versions in revisions.json that are not committed yet
    ./egit pull | push [-y]        git pull / commit and git push of the history files only

Versions are named by model file, with or without .e2k (Hack_v02 or Hack_v02.e2k). `add` follows the
revision log's Add version form (frontend/src/newRevision.ts, frontend/saveRevision.ts) rule for rule.
"""

import argparse
import itertools
import json
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple, TypedDict, cast

from .contract import DiffOutput
from .demo_diffs import write as write_diffs
from .diff import diff_files
from .report import CsvRow, change_rows

ROOT = Path(__file__).resolve().parents[2]
MODELS = Path("frontend/demo_viewer/models")  # relative to the repo root
DIFFS = Path("frontend/demo_viewer/diffs")
MANIFEST = MODELS / "revisions.json"
HISTORY_PATHS = [MODELS.as_posix(), MANIFEST.as_posix(), DIFFS.as_posix()]  # all push ever stages

# --- the Add version rules, ported from frontend/src/newRevision.ts (keep the two in step) ---

SUMMARY_MAX = 72
SCRUBBED_DIR = "C:\\Models\\Hackathon\\"
NAME_RULE = "letters, digits, _ . - only, ending in .e2k"
MAX_BYTES = 200 * 1024 * 1024  # compareE2k.ts MAX_BYTES
_USER_DIR = re.compile(r"[A-Za-z]:\\Users\\(?:[^\\\r\n]+\\)+", re.I)
_PATH_LINE = re.compile(r"\$ File |.* File saved as ")
_FILE_NAME = re.compile(r"[A-Za-z0-9][\w.-]{0,59}\.e2k", re.A)
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", re.A)


class Revision(TypedDict):
    file: str
    parents: List[str]
    summary: str
    body: str
    author: str
    date: str


class EgitError(Exception):
    """A refusal to print as `egit: <message>`."""


def scrub_paths(text: str) -> Tuple[str, int]:
    """Replace user-profile folders in the `$ File` header and save log with SCRUBBED_DIR. Returns (text, count)."""
    replaced = 0

    def scrub(line: str) -> str:
        nonlocal replaced
        if not _PATH_LINE.match(line):
            return line
        out, n = _USER_DIR.subn(lambda _: SCRUBBED_DIR, line)
        replaced += n
        return out

    return "\n".join(scrub(line) for line in text.split("\n")), replaced


def save_log(text: str) -> List[str]:
    """The `File saved as ...` lines of the $ LOG section, oldest first, trimmed."""
    return [line for line in (raw.strip() for raw in text.split("\n")) if re.search(r" File saved as .+ at ", line)]


def _iso_date(stamp: str) -> str:
    """"10/27/2026 1:13:44 PM" -> "2026-10-27T13:13:44"."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)?", stamp, re.I)
    if not m:
        return ""
    mo, d, y, h, mi, s, ap = m.groups()
    hour = int(h) % 12 + (12 if ap and ap.upper() == "PM" else 0) if ap else int(h)
    return f"{y}-{int(mo):02}-{int(d):02}T{hour:02}:{mi}:{s}"


def default_date(text: str) -> str:
    """The `$ File ... saved <time>` header, else the newest save in the save log, else ''."""
    header = re.search(r"^\$ File .* saved (.+)$", text, re.M)
    log = save_log(text)
    return (header and _iso_date(header.group(1))) or _iso_date(log[-1].split(" at ")[-1] if log else "")


def suggest_parent(new_log: List[str], logs: Iterable[Tuple[str, List[str]]]) -> Optional[str]:
    """The version whose save log is the longest prefix of new_log; the first listed wins a tie, None if none share a save."""
    best: Optional[str] = None
    best_n = 0
    for file, log in logs:
        if 0 < len(log) <= len(new_log) and log == new_log[:len(log)] and len(log) > best_n:
            best, best_n = file, len(log)
    return best


def revision_errors(r: Revision, existing: List[Revision], taken: Iterable[str] = ()) -> List[str]:
    """Problems with a new revision, empty when it can be saved. `taken` is every model file name already in use."""
    errors: List[str] = []
    known = {e["file"] for e in existing}
    used = {f.lower() for f in [*known, *taken]}
    if not _FILE_NAME.fullmatch(r["file"]) or "__" in r["file"]:
        errors.append(f'File name must be {NAME_RULE} (no "__", at most 64 characters).')
    elif r["file"].lower() in used:
        errors.append(f"{r['file']} already exists. Pick another file name.")
    errors += [f"Parent {p} is not in the revision log." for p in r["parents"] if p not in known]
    if len(set(r["parents"])) != len(r["parents"]):
        errors.append("A parent is picked twice.")
    if not r["summary"].strip():
        errors.append("Write a summary line.")
    elif len(r["summary"]) > SUMMARY_MAX:
        errors.append(f"Summary is {len(r['summary'])} characters; keep it to {SUMMARY_MAX}.")
    if re.search(r"[\r\n]", r["summary"]):
        errors.append("Summary is one line; put the rest in the body.")
    if not r["author"].strip():
        errors.append("Add an author.")
    elif len(r["author"]) > 100 or re.search(r"[\r\n]", r["author"]):
        errors.append("Author is one line, at most 100 characters.")
    if len(r["body"]) > 10_000:
        errors.append("Body is longer than 10,000 characters.")
    if r["date"] and not _DATE.fullmatch(r["date"]):
        errors.append("Date must look like 2026-10-27T13:12:24.")
    return errors


def model_file_name(upload: str) -> str:
    """"Hack_v07.$et" -> "Hack_v07.e2k"."""
    return re.sub(r"\.(e2k|\$et)\Z", "", upload, flags=re.I) + ".e2k"


def format_manifest(revs: List[Revision]) -> str:
    """revisions.json in its hand-edited layout (saveRevision.ts formatManifest): one key per line, parents on one line."""
    def value(v: object) -> str:
        if isinstance(v, list):
            return "[" + ", ".join(json.dumps(s, ensure_ascii=False) for s in cast(List[str], v)) + "]"
        return json.dumps(v, ensure_ascii=False)
    entries = ["    {\n" + ",\n".join(f"      {json.dumps(k)}: {value(v)}" for k, v in r.items()) + "\n    }" for r in revs]
    return '{\n  "revisions": [\n' + ",\n".join(entries) + "\n  ]\n}\n"


# --- history ---

def load_revisions(root: Path) -> List[Revision]:
    return json.loads((root / MANIFEST).read_text(encoding="utf-8"))["revisions"]


def resolve(revs: List[Revision], name: str) -> Revision:
    for r in revs:
        if name in (r["file"], _stem(r["file"])):
            return r
    raise EgitError(f"{name} is not a version in {MANIFEST.as_posix()} (see: egit log)")


def _stem(file: str) -> str:
    return file[:-4] if file.endswith(".e2k") else file


def _git(root: Path, *args: str, capture: bool = True) -> "subprocess.CompletedProcess[str]":
    sys.stdout.flush()  # keep egit's lines ahead of git's when git writes straight to the terminal
    try:
        return subprocess.run(["git", *args], cwd=root, text=True, capture_output=capture, check=False)
    except FileNotFoundError as exc:
        raise EgitError("git was not found on PATH") from exc


def committed_revisions(root: Path, rev: str = "HEAD") -> List[Revision]:
    """revisions.json as of a commit, [] when there is no such commit or file."""
    out = _git(root, "show", f"{rev}:{MANIFEST.as_posix()}")
    return json.loads(out.stdout)["revisions"] if out.returncode == 0 else []


def uncommitted(root: Path) -> List[Revision]:
    done = {r["file"] for r in committed_revisions(root)}
    return [r for r in load_revisions(root) if r["file"] not in done]


# --- text output ---

_COLORS = {"added": "32", "removed": "31", "modified": "33", "renamed": "33", "moved": "36", "affected": "35",
           "name": "33", "dim": "2"}
_SIGILS = {"added": "+", "removed": "-", "modified": "~", "renamed": "~", "moved": ">", "affected": "!"}
_ORDER = ["added", "removed", "modified", "moved", "affected"]


def _paint(text: str, what: str, color: bool) -> str:
    return f"\033[{_COLORS[what]}m{text}\033[0m" if color else text


def _fmt(v: object) -> str:
    if v == "" or v is None:
        return "none"
    return format(v, ".10g") if isinstance(v, float) else str(v)


def _group_status(rows: List[CsvRow]) -> str:
    statuses = [r.get("status", "") for r in rows]
    if "moved" in statuses:
        return "moved"
    return next((s for s in statuses if s != "renamed"), "modified")


def _fields(rows: List[CsvRow], status: str) -> str:
    out: List[str] = []
    for r in rows:
        field, before, after = r.get("field", ""), r.get("before", ""), r.get("after", "")
        if field:
            out.append(f"{field}: {_fmt(before)} -> {_fmt(after)}")
        elif before != "" and after != "":
            out.append(f"{before} -> {after}")  # a move: old position -> new
        elif before != "" or after != "":
            out.append(f"at {after or before}")
    via = rows[0].get("via", "")
    text = "; ".join(out)
    return f"{text} (via {via.replace(';', ', ')})" if status == "affected" and via else text


def diff_groups(result: DiffOutput) -> List[Tuple[str, str, List[CsvRow]]]:
    """(status, label, rows) per changed element, then per changed table entry, from the CSV report's rows."""
    groups: List[Tuple[str, str, List[CsvRow]]] = []
    for (table, _key), grouped in itertools.groupby(change_rows(result), lambda r: (r.get("table"), r.get("key"))):
        rows = list(grouped)
        first = rows[0]
        if table == "elements":
            label = f"{first.get('subtype')} {first.get('label')}@{first.get('story')}"
        else:
            label = f"{table} {first.get('label')}"
        groups.append((_group_status(rows), label, rows))
    return groups


def counts_text(groups: List[Tuple[str, str, List[CsvRow]]]) -> str:
    elements = [s for s, _label, rows in groups if rows[0].get("table") == "elements"]
    parts = [f"{elements.count(s)} {s}" for s in _ORDER if s in elements]
    tables = len(groups) - len(elements)
    if tables:
        parts.append(f"{tables} table change{'' if tables == 1 else 's'}")
    return ", ".join(parts) or "no changes"


def render_diff(result: DiffOutput, color: bool = False, stat: bool = False) -> str:
    """The diff as terminal text: one line per changed element, then table changes, then counts."""
    groups = diff_groups(result)
    lines = [f"--- {result['meta']['a']['file']}", f"+++ {result['meta']['b']['file']}"]
    if not stat:
        for i, (status, label, rows) in enumerate(groups):
            if i and rows[0].get("table") != "elements" and groups[i - 1][2][0].get("table") == "elements":
                lines.append("")
            lines.append(f"{_paint(_SIGILS[status] + ' ' + label, status, color)}  {_fields(rows, status)}".rstrip())
        lines.append("")
    lines.append(counts_text(groups))
    return "\n".join(lines)


def _grid(marks: Dict[int, str]) -> str:
    """One graph line: lane c sits at column 2c, a / or \\ between lanes at an odd column."""
    width = max(marks) + 1 if marks else 0
    return "".join(marks.get(i, " ") for i in range(width))


def graph(revs: List[Revision], text: Callable[[Revision], List[str]]) -> List[Tuple[str, str]]:
    """`git log --graph` lines newest first as (graph, text): text(rev)[0] sits on the node line, the rest below it.

    Same lane rules as layoutGraph in frontend/src/revisions.ts. ponytail: a lane that ends or opens more than
    one column away from its node gets a single slash, not git's sideways runs; fine for a handful of branches.
    """
    lanes: List[Optional[str]] = []
    out: List[Tuple[str, str]] = []

    def free(ls: List[Optional[str]]) -> int:
        return ls.index(None) if None in ls else len(ls)

    def bars(ls: List[Optional[str]], skip: Iterable[int] = ()) -> Dict[int, str]:
        return {2 * c: "|" for c, f in enumerate(ls) if f is not None and c not in skip}

    for rev in reversed(revs):
        above, file = lanes, rev["file"]
        lane = above.index(file) if file in above else free(above)
        ending = [c for c, f in enumerate(above) if f == file and c != lane]
        if ending:  # lanes that were waiting for this version join its lane
            out.append((_grid({**bars(above, ending), **{2 * c - 1: "/" for c in ending}}), ""))
        first, *rest = text(rev)
        out.append((_grid({**bars(above, ending + [lane]), 2 * lane: "*"}), first))
        below: List[Optional[str]] = [None if f == file else f for f in above]
        below[lane:lane + 1] = [rev["parents"][0] if rev["parents"] else None]
        opened: List[int] = []
        for p in rev["parents"][1:]:
            if p not in below:
                c = free(below)
                below[c:c + 1] = [p]
                opened.append(c)
        if opened:  # a merge opens a lane per extra parent
            out.append((_grid({**bars(below, opened),
                               **{(2 * c - 1 if c > lane else 2 * c + 1): ("\\" if c > lane else "/") for c in opened}}), ""))
        while below and below[-1] is None:
            below.pop()
        out += [(_grid(bars(below)), t) for t in rest]
        lanes = below
    return out


def render_log(revs: List[Revision], counts: Callable[[Revision], str], color: bool = False, long: bool = False) -> str:
    def text(rev: Revision) -> List[str]:
        date = rev["date"].replace("T", " ")[:16]
        line = f"{_paint(_stem(rev['file']), 'name', color)}  {rev['summary']}  {_paint(date, 'dim', color)}  ({counts(rev)})"
        return [line, f"author: {rev['author']}", *textwrap.wrap(rev["body"], 72), ""] if long else [line]

    rows = graph(revs, text)
    width = max((len(g) for g, _ in rows), default=0)
    return "\n".join(f"{g.ljust(width)} {t}".rstrip() for g, t in rows)


# --- commands ---

def _diff_counts(root: Path, revs: List[Revision]) -> Callable[[Revision], str]:
    def counts(rev: Revision) -> str:
        if not rev["parents"]:
            return "root"
        models = root / MODELS
        return counts_text(diff_groups(diff_files(models / rev["parents"][0], models / rev["file"])))
    return counts


def cmd_log(root: Path, long: bool, color: bool) -> int:
    revs = load_revisions(root)
    print(render_log(revs, _diff_counts(root, revs), color, long))
    return 0


def cmd_show(root: Path, name: Optional[str], color: bool) -> int:
    revs = load_revisions(root)
    rev = resolve(revs, name) if name else revs[-1]
    print(_paint(f"version {rev['file']}", "name", color))
    print(f"parents {', '.join(rev['parents']) or '(root)'}")
    print(f"author  {rev['author']}\ndate    {rev['date']}\n")
    print("\n".join("    " + line if line else "" for line in [rev["summary"], ""] + textwrap.wrap(rev["body"], 72)))
    print()
    if not rev["parents"]:
        print("root version, nothing to diff against")
    else:
        print(render_diff(diff_files(root / MODELS / rev["parents"][0], root / MODELS / rev["file"]), color))
    return 0


def _model_path(root: Path, revs: List[Revision], name: str) -> Path:
    try:
        return root / MODELS / resolve(revs, name)["file"]
    except EgitError:
        if Path(name).is_file():
            return Path(name)
        raise


def cmd_diff(root: Path, a: str, b: str, stat: bool, color: bool) -> int:
    revs = load_revisions(root)
    print(render_diff(diff_files(_model_path(root, revs, a), _model_path(root, revs, b)), color, stat))
    return 0


def add_version(root: Path, src: Path, summary: str, body: str, parents: Optional[List[str]], author: str,
                name: Optional[str] = None, regenerate: Callable[[Path, Path], int] = write_diffs) -> Tuple[Revision, Optional[str], int]:
    """Add src as a new version, as the Add version form does. Returns (revision, suggested parent, paths scrubbed).

    parents None means suggest one. Nothing is left behind when a step fails: the model file, revisions.json
    and the diffs folder go back to how they were.
    """
    models, diffs, manifest = root / MODELS, root / DIFFS, root / MANIFEST
    if not re.search(r"\.(e2k|\$et)\Z", src.name, re.I):
        raise EgitError(f"{src.name} is not a .e2k or .$et file.")
    try:
        raw = src.read_bytes()
    except OSError as exc:
        raise EgitError(f"Could not read {src}: {exc.strerror}") from exc
    if not raw or len(raw) > MAX_BYTES:
        raise EgitError("The model file is empty or larger than 200 MB.")
    # latin1 maps every byte to one char and back, so only the scrubbed paths change
    text, scrubbed = scrub_paths(raw.decode("latin1"))
    manifest_text = manifest.read_text(encoding="utf-8")
    revisions: List[Revision] = json.loads(manifest_text)["revisions"]
    suggested = None
    if parents is not None:  # Hack_v06 -> Hack_v06.e2k; an unknown name stays as given for revision_errors
        parents = [next((r["file"] for r in revisions if p in (r["file"], _stem(r["file"]))), p) for p in parents]
    else:
        logs = [(r["file"], save_log((models / r["file"]).read_text(encoding="latin1"))) for r in revisions
                if (models / r["file"]).is_file()]
        suggested = suggest_parent(save_log(text), logs)
        parents = [suggested] if suggested else []
    rev: Revision = {"file": name or model_file_name(src.name), "parents": parents, "summary": summary.strip(),
                     "body": body.strip(), "author": author.strip(), "date": default_date(text)}
    errors = revision_errors(rev, revisions, [p.name for p in models.iterdir()])
    if errors:
        raise EgitError(" ".join(errors))
    if not re.search(r"^\$ PROGRAM INFORMATION", text, re.M):
        raise EgitError(f"{src.name} is not an ETABS text export (no $ PROGRAM INFORMATION section).")
    model = models / rev["file"]
    saved = {p.name: p.read_bytes() for p in diffs.glob("*")} if diffs.is_dir() else {}
    try:
        with open(model, "xb") as fh:  # x: never overwrite a model
            fh.write(text.encode("latin1"))
    except OSError as exc:
        raise EgitError(f"Could not write {rev['file']}: {exc.strerror}") from exc
    try:
        regenerate(models, diffs)
        manifest.write_bytes(format_manifest([*revisions, rev]).encode("utf-8"))
    except BaseException as exc:  # Ctrl+C mid-regenerate rolls back too
        model.unlink(missing_ok=True)
        manifest.write_bytes(manifest_text.encode("utf-8"))
        for p in diffs.glob("*"):
            if p.name not in saved:
                p.unlink()
        for n, data in saved.items():
            (diffs / n).write_bytes(data)
        if isinstance(exc, Exception):
            raise EgitError(f"Nothing was saved. Regenerating the diffs failed: {exc}") from exc
        raise
    return rev, suggested, scrubbed


def _git_author(root: Path) -> str:
    return _git(root, "config", "user.name").stdout.strip()


def cmd_add(root: Path, args: argparse.Namespace) -> int:
    messages: List[str] = args.message
    rev, suggested, scrubbed = add_version(
        root, Path(args.file), messages[0], "\n\n".join(messages[1:]), args.parent or None,
        args.author if args.author is not None else _git_author(root), args.save_as)
    if args.parent is None:
        print(f"parent {suggested}: its save log is the longest prefix of this file's" if suggested
              else "no version shares a save with this file, so it starts a new root")
    if scrubbed:
        print(f"replaced {scrubbed} user folder path{'' if scrubbed == 1 else 's'} with {SCRUBBED_DIR}")
    print(f"added {rev['file']}: {rev['summary']}\ndiffs regenerated; egit push commits and pushes it")
    return 0


def cmd_status(root: Path) -> int:
    new = uncommitted(root)
    if not new:
        print("nothing new: every version in revisions.json is committed")
    for r in new:
        print(f"new  {_stem(r['file'])}  {r['summary']}")
    return 0


def cmd_pull(root: Path) -> int:
    before = {r["file"] for r in load_revisions(root)}
    done = _git(root, "pull", capture=False)
    if done.returncode:
        return done.returncode
    arrived = [r for r in load_revisions(root) if r["file"] not in before]
    print("no new versions" if not arrived else "\n".join(f"new  {_stem(r['file'])}  {r['summary']}" for r in arrived))
    return 0


def _confirm(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() in ("y", "yes")
    except EOFError:
        return False


def cmd_push(root: Path, yes: bool) -> int:
    new = uncommitted(root)
    if not new:
        raise EgitError("nothing new to push: every version in revisions.json is committed")
    message = "\n".join(f"{_stem(r['file'])}: {r['summary']}" for r in new)
    files = _git(root, "status", "--short", "--untracked-files=all", "--", *HISTORY_PATHS).stdout
    print(f"commit message:\n{textwrap.indent(message, '    ')}\nfiles:\n{textwrap.indent(files.rstrip(), '    ')}")
    if not yes and not _confirm("commit these and git push? [y/N] "):
        print("nothing committed")
        return 1
    for step in (["add", "-A", "--", *HISTORY_PATHS], ["commit", "-q", "-m", message, "--", *HISTORY_PATHS]):
        done = _git(root, *step)
        if done.returncode:
            raise EgitError(f"git {step[0]} failed: {(done.stderr or done.stdout).strip()}")
    pushed = _git(root, "push", capture=False)
    if pushed.returncode:
        print("committed locally, but git push failed; fix that and run git push", file=sys.stderr)
    return pushed.returncode


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="egit", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="egit <command> --help shows each command's options.")
    sub = ap.add_subparsers(dest="command", metavar="command")
    log = sub.add_parser("log", help="the history, newest first, with branch lanes and change counts",
                         description="History newest first, like git log --graph --oneline. Counts are against the first parent.")
    log.add_argument("--long", action="store_true", help="add the author and message body")
    show = sub.add_parser("show", help="a version's message and its diff against its first parent",
                          description="A version's message and its diff against its first parent.")
    show.add_argument("version", nargs="?", help="version to show (default: the newest)")
    diff = sub.add_parser("diff", help="the diff between two versions or two .e2k paths",
                          description="The engine's diff from a to b: one line per changed element, then table changes, then counts.")
    diff.add_argument("a", help="older version or .e2k path")
    diff.add_argument("b", help="newer version or .e2k path")
    diff.add_argument("--stat", action="store_true", help="counts only")
    add = sub.add_parser("add", help="add a model file as a new version (same rules as the Add version form)",
                         description="Scrub user folder paths, validate, copy the file into the models folder, "
                                     "append it to revisions.json and regenerate the diffs. Rolls back on failure.")
    add.add_argument("file", help=".e2k or .$et ETABS text export")
    add.add_argument("-m", dest="message", action="append", required=True,
                     help=f"summary (at most {SUMMARY_MAX} characters); repeat for body paragraphs")
    add.add_argument("--parent", action="append", help="parent version, repeat for a merge (default: suggested from the save log)")
    add.add_argument("--author", help="author (default: git config user.name)")
    add.add_argument("--as", dest="save_as", help=f"save as this file name ({NAME_RULE})")
    sub.add_parser("status", help="versions not committed yet", description="Versions in revisions.json that are not committed yet.")
    sub.add_parser("pull", help="git pull, then list the versions that arrived",
                   description="Run git pull, then list the versions that arrived.")
    push = sub.add_parser("push", help="commit the new versions and git push",
                          description="Stage only the models folder, revisions.json and the diffs folder, commit with "
                                      "one line per new version, confirm, then git push. Never force-pushes.")
    push.add_argument("-y", "--yes", action="store_true", help="skip the confirmation")
    return ap


def main(argv: Optional[Sequence[str]] = None, root: Path = ROOT) -> int:
    ap = _parser()
    args = ap.parse_args(argv)
    color = sys.stdout.isatty() and "NO_COLOR" not in os.environ
    try:
        if args.command == "log":
            return cmd_log(root, args.long, color)
        if args.command == "show":
            return cmd_show(root, args.version, color)
        if args.command == "diff":
            return cmd_diff(root, args.a, args.b, args.stat, color)
        if args.command == "add":
            return cmd_add(root, args)
        if args.command == "status":
            return cmd_status(root)
        if args.command == "pull":
            return cmd_pull(root)
        if args.command == "push":
            return cmd_push(root, args.yes)
    except (EgitError, OSError, ValueError) as exc:
        print(f"egit: {exc}", file=sys.stderr)
        return 1
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
