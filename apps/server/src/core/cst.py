from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


def cst_now() -> datetime:
    return datetime.now(CST)
