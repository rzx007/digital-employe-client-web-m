from types import SimpleNamespace
from license_issuer_server import poller as p
from license_issuer_server import poller_config as pc


def test_validate_config_reports_missing():
    assert "app_id" in pc.validate_config({})
    assert pc.validate_config({
        "app_id": "a", "app_secret": "b", "approval_code": "c", "device_field": "d"}) == []


class FakeApproval:
    def __init__(self, instances, forms, commented):
        self._instances = instances
        self._forms = forms
        self._commented = set(commented)
        self.written = []

    def list_instances(self, start_ms, end_ms):
        return list(self._instances)

    def get_instance(self, code):
        return self._forms[code]

    def has_license_comment(self, code, user_id):
        return code in self._commented

    def write_license_comment(self, code, user_id, license_code):
        self.written.append((code, user_id, license_code))
        self._commented.add(code)


def _inst(code, status="APPROVED", user="u1", dev="DEV-1", expires="2027-06-01"):
    return SimpleNamespace(instance_code=code, status=status, user_id=user,
                           device_code=dev, expires=expires)


class FakeIssuer:
    def __init__(self):
        self.calls = []

    def issue(self, device_code, expires, private_key_path):
        self.calls.append((device_code, expires))
        return SimpleNamespace(license_code=f"LIC[{device_code}|{expires}]",
                               device_code_display=device_code, expires_at=None)


def _run_once(approval, issuer, default_expires="+90d"):
    return p.poll_once(approval, issuer, private_key_path="/k/private.pem",
                       default_expires=default_expires, window_ms=(1, 2))


def test_approved_uncommented_issues_and_writes():
    ap = FakeApproval(["I1"], {"I1": _inst("I1")}, commented=[])
    iss = FakeIssuer()
    n = _run_once(ap, iss)
    assert n == 1
    assert iss.calls == [("DEV-1", "2027-06-01")]
    assert ap.written == [("I1", "u1", "LIC[DEV-1|2027-06-01]")]


def test_already_commented_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1")}, commented=["I1"])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []
    assert ap.written == []


def test_non_approved_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", status="PENDING")}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []


def test_missing_device_skipped():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", dev=None)}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss) == 0
    assert iss.calls == []


def test_missing_expires_falls_back_to_default():
    ap = FakeApproval(["I1"], {"I1": _inst("I1", expires=None)}, commented=[])
    iss = FakeIssuer()
    assert _run_once(ap, iss, default_expires="+90d") == 1
    assert iss.calls == [("DEV-1", "+90d")]


def test_one_failure_does_not_block_others():
    ap = FakeApproval(["I1", "I2"], {"I1": _inst("I1"), "I2": _inst("I2", dev="DEV-2")},
                      commented=[])

    iss = FakeIssuer()
    orig = iss.issue
    def flaky(device_code, expires, private_key_path):
        if device_code == "DEV-1":
            raise RuntimeError("boom")
        return orig(device_code, expires, private_key_path)
    iss.issue = flaky
    n = _run_once(ap, iss)
    assert n == 1
    assert ap.written == [("I2", "u1", "LIC[DEV-2|2027-06-01]")]
