"""CLI: python -m diff_engine before.e2k after.e2k [-o out.json] [--csv changes.csv] [--view]"""

import argparse
import json
import logging
import sys
import tempfile
from typing import Optional, Sequence

from .contract import DiffOutput
from .diff import DEFAULT_MOVE_TOLERANCE, diff_files


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m diff_engine", description=__doc__)
    ap.add_argument("before", help="older .e2k or .$et")
    ap.add_argument("after", help="newer .e2k or .$et")
    ap.add_argument("-o", "--output", help="write JSON here instead of stdout")
    ap.add_argument("--csv", help="also write a CSV change report here, one row per change")
    ap.add_argument("--tolerance", type=float, default=None,
                    help="node match tolerance in inches (default: PREFERENCE MERGETOL of the before file)")
    ap.add_argument("--move-tolerance", type=float, default=DEFAULT_MOVE_TOLERANCE,
                    help=f"max end travel in inches to link a removed and added frame as moved, 0 turns it off "
                         f"(default {DEFAULT_MOVE_TOLERANCE})")
    ap.add_argument("--view", action="store_true",
                    help="serve the viewer on this diff at 127.0.0.1 and open it in the browser (JSON goes to -o or a temp file)")
    ap.add_argument("--summary", action="store_true", help="print only the summary block")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    try:
        result = diff_files(args.before, args.after, args.tolerance, args.move_tolerance)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.csv:
        from .report import write_csv
        try:
            write_csv(result, args.csv)
        except OSError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    if args.view:
        return _view(result, args.output)
    text = json.dumps(result["summary"] if args.summary else result, indent=1)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        print(text)
    return 0


def _view(result: DiffOutput, output: Optional[str]) -> int:
    from .serve import run
    # temp dir unless -o was given, never demo_viewer/, so real model output stays out of the repo
    with tempfile.TemporaryDirectory(prefix="etabs-diff-") as tmp:
        path = output or f"{tmp}/diff.json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1)
        run(path)
    return 0

if __name__ == "__main__":
    sys.exit(main())
