"""CLI: python -m diff_engine before.e2k after.e2k [-o out.json]"""

import argparse
import json
import logging
import sys

from .diff import DEFAULT_MOVE_TOLERANCE, DEFAULT_TOLERANCE, diff_files


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m diff_engine", description=__doc__)
    ap.add_argument("before", help="older .e2k or .$et")
    ap.add_argument("after", help="newer .e2k or .$et")
    ap.add_argument("-o", "--output", help="write JSON here instead of stdout")
    ap.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE,
                    help=f"node match tolerance in m (default {DEFAULT_TOLERANCE})")
    ap.add_argument("--move-tolerance", type=float, default=DEFAULT_MOVE_TOLERANCE,
                    help=f"max end travel in m to pair a removed and added member as moved, 0 turns it off "
                         f"(default {DEFAULT_MOVE_TOLERANCE})")
    ap.add_argument("--include-unchanged", action="store_true", help="also list unchanged elements and definitions")
    ap.add_argument("--summary", action="store_true", help="print only the summary block")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    try:
        result = diff_files(args.before, args.after, args.tolerance, args.move_tolerance, args.include_unchanged)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    text = json.dumps(result["summary"] if args.summary else result, indent=1)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
