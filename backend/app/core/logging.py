"""Centralised logging setup."""
import logging
import sys


def setup_logging(level: int = logging.INFO) -> None:
    fmt = "%(asctime)s | %(levelname)-7s | %(name)-22s | %(message)s"
    logging.basicConfig(level=level, format=fmt, stream=sys.stdout, force=True)
    # quiet noisy libs
    for noisy in ("httpx", "httpcore", "urllib3", "sqlalchemy.engine.Engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)