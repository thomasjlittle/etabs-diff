"""egit: log graph, diff text, add (the Add version form's rules and rollback), and status/push/pull on temp git repos.

Nothing here touches the real remote: push and pull run against a bare repo in a temp folder.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import List
from unittest import mock

from diff_engine import diff_files
from diff_engine.demo_diffs import MODELS_DIR, write
from diff_engine.egit import (
    DIFFS, MANIFEST, MODELS, EgitError, Revision, add_version, cmd_pull, cmd_push, format_manifest, graph, main,
    render_diff, revision_errors, scrub_paths,
)


def rev(file: str, *parents: str) -> Revision:
    return {"file": file, "parents": list(parents), "summary": file, "body": "", "author": "a", "date": ""}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def make_root(tmp: Path) -> Path:
    """A repo-shaped folder holding Hack_v01 and Hack_v01a, their revisions.json entries and diffs."""
    root = tmp / "repo"
    (root / MODELS).mkdir(parents=True)
    real: List[Revision] = json.loads((MODELS_DIR / "revisions.json").read_text(encoding="utf-8"))["revisions"]
    for r in real[:2]:
        shutil.copy(MODELS_DIR / r["file"], root / MODELS / r["file"])
    (root / MANIFEST).write_text(format_manifest(real[:2]), encoding="utf-8")
    write(root / MODELS, root / DIFFS)
    return root


def user_copy(tmp: Path, name: str = "Hack_v02.e2k") -> Path:
    """Hack_v02 as it would come off a laptop: user folder paths in the header and save log."""
    src = tmp / name
    src.write_bytes((MODELS_DIR / "Hack_v02.e2k").read_bytes()
                    .replace(b"C:\\Models\\Hackathon\\", b"C:\\Users\\jdoe\\OneDrive\\Proj\\"))
    return src


class GraphTest(unittest.TestCase):
    def test_real_history_draws_the_v02a_branch_lane(self) -> None:
        revs: List[Revision] = json.loads((MODELS_DIR / "revisions.json").read_text(encoding="utf-8"))["revisions"]
        got = [f"{g} {t}".rstrip() for g, t in graph(revs, lambda r: [r["file"][:-4]])]
        self.assertEqual(got, ["* Hack_v06", "* Hack_v05", "* Hack_v04", "* Hack_v03", "| * Hack_v02a", "|/",
                               "* Hack_v02", "* Hack_v01a", "* Hack_v01"])

    def test_merge_opens_a_lane_and_long_lines_follow_it(self) -> None:
        revs = [rev("a"), rev("b", "a"), rev("c", "a"), rev("d", "b", "c")]
        got = [f"{g} {t}".rstrip() for g, t in graph(revs, lambda r: [r["file"], "  " + r["file"] + " body"])]
        self.assertEqual(got, ["* d", "|\\", "| |   d body", "| * c", "| |   c body", "* | b", "| |   b body",
                               "|/", "* a", "   a body"])


class DiffTextTest(unittest.TestCase):
    def test_v01a_to_v02(self) -> None:
        text = render_diff(diff_files(MODELS_DIR / "Hack_v01a.e2k", MODELS_DIR / "Hack_v02.e2k"))
        self.assertEqual(text.splitlines(), [
            "--- Hack_v01a.e2k", "+++ Hack_v02.e2k",
            "~ column C1@Story1  ANG: 0 -> 90",
            "~ column C3@Story1  SECTION: W10X60 -> W16X36",
            "! beam B2@Story1  frameSection:Conc16x10.MATERIAL: 4Ksi -> 6Ksi (via frameSection:Conc16x10)",
            "",
            "~ frameSections Conc16x10  MATERIAL: 4Ksi -> 6Ksi",
            "",
            "2 modified, 1 affected, 1 table change",
        ])

    def test_moves_adds_and_stat(self) -> None:
        result = diff_files(MODELS_DIR / "Hack_v02.e2k", MODELS_DIR / "Hack_v03.e2k")
        lines = render_diff(result).splitlines()
        self.assertIn("> beam B1 -> B7@Story1  (0, 0, 144) (240, 0, 144) -> (0, 0, 144) (300, 0, 144)", lines)
        self.assertIn("+ beam B5@Story1  at (120, 0, 144) (120, 144, 144)", lines)
        self.assertEqual(render_diff(result, stat=True).splitlines()[2:], ["2 added, 1 moved"])
        self.assertIn("\033[36m> beam B1 -> B7@Story1\033[0m", render_diff(result, color=True))

    def test_unit_change_diffs_clean(self) -> None:
        text = render_diff(diff_files(MODELS_DIR / "Hack_v02.e2k", MODELS_DIR / "Hack_v02a.e2k"))
        self.assertEqual(text.splitlines()[-1], "no changes")


class AddTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.root = make_root(self.tmp)

    def state(self) -> object:
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def test_scrubs_suggests_the_parent_and_appends(self) -> None:
        added, suggested, scrubbed = add_version(self.root, user_copy(self.tmp), "Change member properties", "", None, "Me")
        self.assertEqual(suggested, "Hack_v01a.e2k")
        self.assertEqual(scrubbed, 6)  # the $ File header and five save log lines
        self.assertEqual(added, {"file": "Hack_v02.e2k", "parents": ["Hack_v01a.e2k"], "summary": "Change member properties",
                                 "body": "", "author": "Me", "date": "2026-10-27T13:12:24"})
        self.assertEqual((self.root / MODELS / "Hack_v02.e2k").read_bytes(), (MODELS_DIR / "Hack_v02.e2k").read_bytes())
        self.assertEqual(json.loads((self.root / MANIFEST).read_text(encoding="utf-8"))["revisions"][-1], added)
        self.assertTrue((self.root / DIFFS / "Hack_v01a__Hack_v02.json").is_file())

    def test_refusals_leave_everything_as_it_was(self) -> None:
        before = self.state()
        src = user_copy(self.tmp)
        cases = [  # (summary, parents, author, save as), the refusal
            (("x" * 73, None, "Me", None), "Summary is 73 characters; keep it to 72."),
            (("  ", None, "Me", None), "Write a summary line."),
            (("ok", ["Hack_v09"], "Me", None), "Parent Hack_v09 is not in the revision log."),
            (("ok", None, "Me", "Hack_v01.e2k"), "Hack_v01.e2k already exists."),
            (("ok", None, "Me", "a__b.e2k"), "File name must be"),
            (("ok", None, "", None), "Add an author."),
        ]
        for (summary, parents, author, name), message in cases:
            with self.subTest(message), self.assertRaisesRegex(EgitError, message.replace(".", r"\.")):
                add_version(self.root, src, summary, "", parents, author, name)
        src.unlink()
        not_etabs = self.tmp / "notes.e2k"
        not_etabs.write_text("hello\n", encoding="utf-8")
        with self.assertRaisesRegex(EgitError, "not an ETABS text export"):
            add_version(self.root, not_etabs, "ok", "", [], "Me")
        self.assertEqual(self.state(), before)

    def test_parent_names_resolve_without_the_extension(self) -> None:
        added, _, _ = add_version(self.root, user_copy(self.tmp), "ok", "", ["Hack_v01"], "Me", "Side.e2k")
        self.assertEqual(added["parents"], ["Hack_v01.e2k"])

    def test_failed_regenerate_rolls_back(self) -> None:
        before = self.state()

        def broken(models: Path, diffs: Path) -> int:
            (diffs / "half-written.json").write_text("{", encoding="utf-8")
            (diffs / "Hack_v01__Hack_v01a.json").write_text("{", encoding="utf-8")
            raise ValueError("engine fell over")

        with self.assertRaisesRegex(EgitError, "Nothing was saved.*engine fell over"):
            add_version(self.root, user_copy(self.tmp), "ok", "", None, "Me", regenerate=broken)
        self.assertEqual(self.state(), before)

    def test_matches_the_form_rules(self) -> None:
        ok: Revision = {"file": "Hack_v07.e2k", "parents": ["Hack_v06.e2k"], "summary": "Add Story3", "body": "",
                        "author": "Me", "date": ""}
        existing = [rev("Hack_v06.e2k")]
        self.assertEqual(revision_errors(ok, existing), [])
        self.assertEqual(revision_errors({**ok, "parents": ["Hack_v06.e2k", "Hack_v06.e2k"]}, existing), ["A parent is picked twice."])
        self.assertEqual(revision_errors({**ok, "date": "yesterday"}, existing), ["Date must look like 2026-10-27T13:12:24."])
        self.assertEqual(revision_errors(ok, existing, ["hack_V07.e2k"]), ["Hack_v07.e2k already exists. Pick another file name."])

    def test_scrub_only_touches_header_and_save_log(self) -> None:
        raw = "\r\n".join([
            "$ File C:\\Users\\jdoe\\OneDrive - Some Co\\Proj\\Hack_v07.e2k saved 10/27/2026 3:01:02 PM",
            '  MATERIAL "C:\\Users\\jdoe\\keep.txt"',
            "ETABS Nonlinear 23.1.1 File saved as c:\\users\\jdoe\\Desktop\\Hack_v07.EDB at 10/27/2026 3:00:00 PM",
        ])
        text, n = scrub_paths(raw)
        self.assertEqual(n, 2)
        self.assertEqual(text.split("\r\n"), [
            "$ File C:\\Models\\Hackathon\\Hack_v07.e2k saved 10/27/2026 3:01:02 PM",
            '  MATERIAL "C:\\Users\\jdoe\\keep.txt"',
            "ETABS Nonlinear 23.1.1 File saved as C:\\Models\\Hackathon\\Hack_v07.EDB at 10/27/2026 3:00:00 PM",
        ])

    def test_manifest_layout_round_trips(self) -> None:
        text = (MODELS_DIR / "revisions.json").read_text(encoding="utf-8")
        self.assertEqual(format_manifest(json.loads(text)["revisions"]), text)


class GitTest(unittest.TestCase):
    """status, push and pull between two clones of a bare repo in a temp folder."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        env = mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        env.start()
        self.addCleanup(env.stop)
        self.remote = self.tmp / "remote.git"
        git(self.tmp, "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.root = make_root(self.tmp)
        self.configure(self.root, init=True)
        (self.root / "notes.txt").write_text("not history\n", encoding="utf-8")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "start")
        git(self.root, "push", "-q", "-u", "origin", "main")

    def configure(self, repo: Path, init: bool = False) -> None:
        if init:
            git(repo, "init", "-q", "-b", "main")
            git(repo, "remote", "add", "origin", str(self.remote))
        git(repo, "config", "user.name", "Tester")
        git(repo, "config", "user.email", "tester@example.com")

    def run_egit(self, *argv: str, root: Path) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.assertEqual(main(list(argv), root), 0, out.getvalue())
        return out.getvalue()

    def test_push_commits_only_history_then_pull_lists_it(self) -> None:
        (self.root / "notes.txt").write_text("edited, not for egit\n", encoding="utf-8")
        (self.root / "scratch.txt").write_text("untracked\n", encoding="utf-8")
        add_version(self.root, user_copy(self.tmp), "Change member properties", "", None, "Me")
        self.assertIn("new  Hack_v02  Change member properties", self.run_egit("status", root=self.root))

        with mock.patch("builtins.input", return_value="n"), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cmd_push(self.root, yes=False), 1)
        self.assertEqual(git(self.root, "diff", "--cached", "--name-only"), "")

        self.run_egit("push", "-y", root=self.root)
        self.assertEqual(git(self.remote, "log", "-1", "--format=%B", "main").strip(), "Hack_v02: Change member properties")
        changed = git(self.remote, "show", "--name-only", "--format=", "main").split()
        self.assertTrue(changed and all(f.startswith(("frontend/demo_viewer/models/", "frontend/demo_viewer/diffs/")) for f in changed))
        self.assertIn("frontend/demo_viewer/models/Hack_v02.e2k", changed)
        self.assertEqual(git(self.root, "status", "--short").split(), ["M", "notes.txt", "??", "scratch.txt"])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(main(["push", "-y"], self.root), 1)
        self.assertIn("nothing new to push", err.getvalue())

        other = self.tmp / "other"
        git(self.tmp, "clone", "-q", str(self.remote), str(other))
        git(other, "reset", "-q", "--hard", "HEAD~1")
        self.configure(other)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cmd_pull(other), 0)
        self.assertIn("new  Hack_v02  Change member properties", out.getvalue())
        self.assertIn("no new versions", self.run_egit("pull", root=other))


if __name__ == "__main__":
    unittest.main()
